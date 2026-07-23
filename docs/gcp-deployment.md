# Deploy ORAtlas to Google Cloud Run

This guide deploys the ORAtlas proof of concept with:

- Cloud Run for the Next.js application
- Cloud SQL for PostgreSQL
- Artifact Registry for container images
- Secret Manager for application secrets
- Cloud Build for build, database bootstrap, and deployment

The checked-in SQLite schema remains the local-development default. The container build generates the Prisma client from `packages/db/prisma/schema.postgres.prisma`.

## 1. Set the project and region

```bash
export PROJECT_ID="your-gcp-project"
export REGION="europe-west1"
export SERVICE="oratlas"
export SQL_INSTANCE="oratlas-postgres"

gcloud config set project "$PROJECT_ID"
gcloud config set run/region "$REGION"
```

Enable the required APIs:

```bash
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com
```

## 2. Create Artifact Registry

```bash
gcloud artifacts repositories create oratlas \
  --repository-format=docker \
  --location="$REGION" \
  --description="ORAtlas container images"
```

If the repository already exists, continue.

## 3. Create PostgreSQL

The following shared-core instance is suitable for a low-traffic proof of concept. Increase availability, CPU, memory, storage, and backup settings before treating it as a production service.

```bash
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_16 \
  --region="$REGION" \
  --tier=db-f1-micro \
  --storage-type=SSD \
  --storage-size=10GB \
  --availability-type=zonal

gcloud sql databases create oratlas --instance="$SQL_INSTANCE"
```

Create an application user. Use a generated password that does not contain characters requiring manual URL re-encoding, or URL-encode it before constructing `DATABASE_URL`.

```bash
export DB_USER="oratlas"
export DB_PASSWORD="$(openssl rand -hex 24)"

gcloud sql users create "$DB_USER" \
  --instance="$SQL_INSTANCE" \
  --password="$DB_PASSWORD"
```

The Cloud Run service connects through the Cloud SQL Unix socket. Construct the Prisma URL:

```bash
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/oratlas?host=/cloudsql/${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
```

## 4. Create secrets

```bash
printf '%s' "$DATABASE_URL" | \
  gcloud secrets create oratlas-database-url --data-file=-

openssl rand -hex 32 | tr -d '\n' | \
  gcloud secrets create oratlas-session-secret --data-file=-
```

Optional GitHub integration secrets:

```bash
printf '%s' "YOUR_GITHUB_CLIENT_SECRET" | \
  gcloud secrets create oratlas-github-client-secret --data-file=-

printf '%s' "YOUR_GITHUB_TOKEN" | \
  gcloud secrets create oratlas-github-token --data-file=-
```

Do not create optional secrets with empty values. The Cloud Build deployment step adds them only when they exist.

## 5. Grant Cloud Build deployment permissions

```bash
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

for ROLE in \
  roles/artifactregistry.writer \
  roles/run.admin \
  roles/cloudsql.client \
  roles/secretmanager.secretAccessor \
  roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${BUILD_SA}" \
    --role="$ROLE"
done
```

For a hardened deployment, replace project-wide grants with a dedicated deployment service account and resource-level permissions.

## 6. Submit the deployment

From the repository root:

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions="_REGION=${REGION},_SERVICE=${SERVICE},_CLOUD_SQL_INSTANCE=${SQL_INSTANCE},_NEXT_PUBLIC_BASE_URL="
```

The build performs these steps:

1. build and push the container image;
2. create or update the `${SERVICE}-migrate` Cloud Run Job;
3. execute `pnpm db:deploy:postgres` against Cloud SQL;
4. deploy the Cloud Run service;
5. expose the service publicly.

`db:deploy:postgres` currently uses `prisma db push` against the generated PostgreSQL schema, followed by ORAtlas database guards. This is intended to bootstrap the POC quickly. Before maintaining valuable production data, replace this bootstrap workflow with reviewed and committed Prisma migrations.

## 7. Configure GitHub OAuth

Retrieve the deployed service URL:

```bash
export SERVICE_URL="$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --format='value(status.url)')"
echo "$SERVICE_URL"
```

Create or update the GitHub OAuth App with:

```text
Homepage URL:              SERVICE_URL
Authorization callback:   SERVICE_URL/api/auth/github/callback
```

Redeploy with the client ID and canonical URL:

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions="_REGION=${REGION},_SERVICE=${SERVICE},_CLOUD_SQL_INSTANCE=${SQL_INSTANCE},_GITHUB_CLIENT_ID=YOUR_CLIENT_ID,_NEXT_PUBLIC_BASE_URL=${SERVICE_URL}"
```

`AUTH_MOCK` must not be configured in production.

## 8. Verify the deployment

```bash
curl -fsS "${SERVICE_URL}/api/health"
```

Expected response:

```json
{"status":"ok"}
```

Then inspect logs:

```bash
gcloud run services logs read "$SERVICE" \
  --region="$REGION" \
  --limit=100
```

## Operational constraints of the POC

The initial deployment deliberately limits Cloud Run to three instances because some ORAtlas facilities remain process-local:

- rate limiting;
- search;
- knowledge-index rebuilding;
- synchronous ingestion.

For larger public usage, move ingestion to Cloud Tasks or Pub/Sub, use PostgreSQL full-text search or another shared search provider, and place shared rate-limit/cache state in Redis or another durable service.

## Updating secrets

Create a new secret version rather than replacing the secret resource:

```bash
printf '%s' 'NEW_VALUE' | \
  gcloud secrets versions add SECRET_NAME --data-file=-
```

A subsequent Cloud Run deployment resolves the `latest` version.

## Database safety

Before importing real or irreplaceable data:

- enable automated backups and point-in-time recovery;
- test `pg_dump` and restore;
- replace `prisma db push` with committed migrations;
- test migration and rollback against a staging database;
- use a dedicated runtime service account with least privilege.
