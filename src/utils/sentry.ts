import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";

// Initialize Sentry only if DSN is provided
let sentryInitialized = false;

export const initSentry = (): boolean => {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    logger.info("Sentry DSN not provided, error reporting disabled");
    return false;
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      release: process.env.npm_package_version || "1.0.0",

      // Performance monitoring
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

      // Filter out sensitive data
      beforeSend(event) {
        // Remove any sensitive data before sending
        if (event.request) {
          // Remove authorization headers
          if (event.request.headers) {
            delete event.request.headers["authorization"];
            delete event.request.headers["cookie"];
            delete event.request.headers["x-admin-session"];
          }
        }
        return event;
      },

      // Ignore common non-critical errors
      ignoreErrors: [
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "EHOSTUNREACH",
      ],
    });

    sentryInitialized = true;
    logger.info("Sentry error reporting initialized");
    return true;
  } catch (error) {
    logger.error("Failed to initialize Sentry", { error });
    return false;
  }
};

// Capture an exception with optional context
export const captureException = (
  error: Error | unknown,
  context?: Record<string, unknown>,
): void => {
  if (!sentryInitialized) {
    return;
  }

  if (context) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
};

// Capture a message with severity level
export const captureMessage = (
  message: string,
  level: "info" | "warning" | "error" = "info",
  context?: Record<string, unknown>,
): void => {
  if (!sentryInitialized) {
    return;
  }

  if (context) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
      Sentry.captureMessage(message, level);
    });
  } else {
    Sentry.captureMessage(message, level);
  }
};

// Set user context for error tracking
export const setUser = (user: {
  id: string;
  username?: string;
  email?: string;
}): void => {
  if (!sentryInitialized) {
    return;
  }

  Sentry.setUser(user);
};

// Clear user context
export const clearUser = (): void => {
  if (!sentryInitialized) {
    return;
  }

  Sentry.setUser(null);
};

// Add a breadcrumb for tracking user actions
export const addBreadcrumb = (breadcrumb: {
  message: string;
  category?: string;
  level?: "info" | "warning" | "error";
  data?: Record<string, unknown>;
}): void => {
  if (!sentryInitialized) {
    return;
  }

  const breadcrumbData: Sentry.Breadcrumb = {
    message: breadcrumb.message,
    category: breadcrumb.category || "app",
    level: breadcrumb.level || "info",
  };

  if (breadcrumb.data) {
    breadcrumbData.data = breadcrumb.data;
  }

  Sentry.addBreadcrumb(breadcrumbData);
};

// Check if Sentry is initialized
export const isSentryInitialized = (): boolean => sentryInitialized;

// Flush all pending events (useful before process exit)
export const flush = async (timeout = 2000): Promise<boolean> => {
  if (!sentryInitialized) {
    return true;
  }

  return Sentry.flush(timeout);
};

// Export Sentry for advanced usage
export { Sentry };
