/*
https://docs.nestjs.com/controllers#controllers
*/

import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
    @Get()
    healthCheck() {
        return { status: 'ok', timestamp: new Date().toISOString() };
    }
}
