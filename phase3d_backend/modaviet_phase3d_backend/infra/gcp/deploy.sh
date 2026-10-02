#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID}"; : "${GOOGLE_CLIENT_ID:=}";
REGION=${REGION:-asia-southeast1}; SERVICE=${SERVICE:-modaviet-kho-npl-v2-pilot}; INSTANCE=${INSTANCE:-modaviet-kho-npl-v2-pilot}; DB_NAME=${DB_NAME:-modaviet_kho}; DB_USER=${DB_USER:-modaviet_app}; REPO=${REPO:-modaviet}; IMAGE=${IMAGE:-kho-npl-v2};
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
# Artifact Registry
(gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1) || gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION"
# Cloud SQL PostgreSQL
(gcloud sql instances describe "$INSTANCE" >/dev/null 2>&1) || gcloud sql instances create "$INSTANCE" --database-version=POSTGRES_16 --region="$REGION" --tier=db-custom-1-3840 --storage-type=SSD --storage-size=20 --availability-type=zonal
(gcloud sql databases describe "$DB_NAME" --instance="$INSTANCE" >/dev/null 2>&1) || gcloud sql databases create "$DB_NAME" --instance="$INSTANCE"
if ! gcloud secrets describe modaviet-kho-db-password >/dev/null 2>&1; then
  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
  printf %s "$DB_PASSWORD" | gcloud secrets create modaviet-kho-db-password --data-file=-
  gcloud sql users create "$DB_USER" --instance="$INSTANCE" --password="$DB_PASSWORD"
fi
CONNECTION_NAME=$(gcloud sql instances describe "$INSTANCE" --format='value(connectionName)')
TAG="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$IMAGE:phase3d-0.1.0"
gcloud builds submit --tag "$TAG" .
gcloud run deploy "$SERVICE" --image "$TAG" --region "$REGION" --no-allow-unauthenticated --min 1 --max 5 --concurrency 20 --cpu 1 --memory 1Gi --timeout 15s \
  --add-cloudsql-instances "$CONNECTION_NAME" \
  --set-env-vars "NODE_ENV=production,DB_USER=$DB_USER,DB_NAME=$DB_NAME,INSTANCE_CONNECTION_NAME=$CONNECTION_NAME,DB_POOL_MAX=10,ALLOWED_GOOGLE_DOMAIN=modaviet.vn,AUTH_BYPASS_FOR_LOCAL=true,PERFORMANCE_TARGET_P95_MS=1500" \
  --set-secrets "DB_PASSWORD=modaviet-kho-db-password:latest"
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
echo "SERVICE_URL=$URL"
echo "Next: grant Cloud Run Invoker only to Pilot tester/service account, then migrate/seed/regression."
