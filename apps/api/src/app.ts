import 'reflect-metadata';
import {
  Module,
  Controller,
  Get,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import { Database } from './db';
import { Auth, AuthController } from './auth';
import { Mail } from './mail';
import { Catalogue, CatalogueController } from './catalogue';
import { Orders, OrdersController } from './orders';
import { Payments, PaymentsController } from './payments';
import { Community, CommunityController } from './community';
import { AdminController } from './admin';
import { config } from './config';

@Controller()
class HealthController {
  constructor(private readonly db: Database) {}
  @Get('health') async health() {
    await this.db.rows('SELECT 1');
    return { status: 'ok', runtime: 'node', version: 1 };
  }
  @Get('capabilities') capabilities() {
    return { mpesa_enabled: config.MPESA_ENABLED };
  }
}
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const parserStatus = (error as { status?: number } | null)?.status;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : parserStatus && [400, 413, 415].includes(parserStatus)
          ? parserStatus
          : 500;
    if (status >= 500)
      console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json({
      message:
        error instanceof HttpException
          ? error.message
          : status === 413
            ? 'Request exceeds the allowed size.'
            : status === 400
              ? 'Invalid request body.'
              : 'The request could not be completed. Try again later.',
    });
  }
}
@Module({
  controllers: [
    HealthController,
    AuthController,
    CatalogueController,
    OrdersController,
    PaymentsController,
    CommunityController,
    AdminController,
  ],
  providers: [Database, Auth, Mail, Catalogue, Orders, Payments, Community],
})
export class AppModule {}
export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn'],
  });
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY || false);
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use('/api', (_req: unknown, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(app.get(Auth).middleware);
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  return app;
}
