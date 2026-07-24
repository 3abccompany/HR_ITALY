import "server-only";

const LOCALHOST_SUFFIX = ".localhost";
const CLOUD_WORKSTATIONS_SUFFIX = ".cloudworkstations.dev";
const FIREBASE_STUDIO_HOST_FRAGMENT = "firebase-studio";

export function getExternalPublicBaseUrl() {
  const configuredUrl = process.env.APP_PUBLIC_URL?.trim();

  if (!configuredUrl) {
    throw new Error("APP_PUBLIC_URL must be configured to generate external public links.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error("APP_PUBLIC_URL must be a valid absolute HTTPS URL.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (parsedUrl.protocol !== "https:") {
    throw new Error("APP_PUBLIC_URL must use HTTPS.");
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("APP_PUBLIC_URL must not contain credentials.");
  }

  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error("APP_PUBLIC_URL must not contain a query string or fragment.");
  }

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(LOCALHOST_SUFFIX) ||
    hostname === "cloudworkstations.dev" ||
    hostname.endsWith(CLOUD_WORKSTATIONS_SUFFIX) ||
    hostname.includes(FIREBASE_STUDIO_HOST_FRAGMENT)
  ) {
    throw new Error("APP_PUBLIC_URL must be a stable public application URL.");
  }

  return parsedUrl.origin;
}

export function buildExternalPublicUrl(path: string, baseUrl = getExternalPublicBaseUrl()) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("External public link path must be an application-relative path.");
  }

  const resolvedUrl = new URL(path, `${baseUrl}/`);

  if (resolvedUrl.origin !== baseUrl) {
    throw new Error("External public link path must not replace the configured host.");
  }

  return resolvedUrl.toString();
}
