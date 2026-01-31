export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return Response.json(
      { error: 'Not implemented', worker: 'singlefile' },
      { status: 501 }
    );
  }
};
