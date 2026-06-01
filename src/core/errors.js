export class AppError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function toErrorResponse(error) {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: true,
        message: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {})
      }
    };
  }

  console.error("[market-data-api] Unhandled error:", error);
  return {
    statusCode: 500,
    body: {
      error: true,
      message: "Erro interno do servidor",
      code: "INTERNAL_SERVER_ERROR"
    }
  };
}
