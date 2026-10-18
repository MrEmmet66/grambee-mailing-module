import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { resolve } from 'node:path';
import { ServiceOnly } from '../auth/decorators/auth-policy.decorator';

@ServiceOnly()
@Controller('internal/audiences')
export class AudienceFilesController {
  @Get(':filename')
  download(@Param('filename') filename: string, @Res() response: Response) {
    // Supports legacy names during rollout; no path separators or traversal.
    if (!/^[a-zA-Z0-9_-]+\.txt$/.test(filename)) throw new NotFoundException();
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="audience.txt"',
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.sendFile(
      filename,
      { root: resolve('uploads/bot_users'), dotfiles: 'deny' },
      (error) => {
        if (error && !response.headersSent) response.status(404).end();
      },
    );
  }
}
