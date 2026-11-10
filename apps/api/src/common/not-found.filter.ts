import { ArgumentsHost, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import { renderLanding } from './landing';
import { uiState } from './ui-state';

/**
 * Catches "this address does not exist" and answers browsers with the Persian
 * landing page instead of `{"message":"Cannot GET /api/...","statusCode":404}`.
 * API clients (Accept: application/json) keep the usual JSON error.
 */
@Catch(NotFoundException)
export class NotFoundFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req: any = ctx.getRequest();
    const res: any = ctx.getResponse();
    const accept = String(req.headers?.accept || '');

    if (!accept.includes('text/html')) {
      const body = exception.getResponse();
      return res
        .status(exception.getStatus())
        .json(typeof body === 'string' ? { statusCode: 404, message: body } : body);
    }

    res
      .status(uiState.uiReady ? 404 : 503)
      .type('html')
      .set('Cache-Control', 'no-store')
      .send(renderLanding({ uiReady: uiState.uiReady, requestedPath: req.path || '/' }));
  }
}
