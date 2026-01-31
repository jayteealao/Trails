import type { HttpFunction } from '@google-cloud/functions-framework';

export const handleRequest: HttpFunction = (req, res) => {
  res.status(501).json({
    error: 'Not implemented',
    service: 'archive-gateway'
  });
};
