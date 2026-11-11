export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly outcome: 'rejected' | 'uncertain' = status > 0 && status < 500
      ? 'rejected'
      : 'uncertain',
    public readonly operationId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
