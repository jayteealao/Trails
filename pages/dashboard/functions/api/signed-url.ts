import { proxyToApi, type Env } from './_proxy.js';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  return proxyToApi(context.env, 'signed-url', new URL(context.request.url).search);
};
