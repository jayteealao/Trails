import { proxyToApi, type Env } from '../_proxy.js';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  return proxyToApi(context.env, `articles/${context.params.itemId}`);
};
