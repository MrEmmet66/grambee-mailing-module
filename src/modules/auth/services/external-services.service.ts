import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';


export interface ExternalUserDto {
  telegramId: string;
  username?: string;
  password?: string; // Optional, used for external services that require it
}

export interface ExternalServiceRegisterResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
}

export interface GreetingsUserDto {
  telegram_id: number;
  username?: string;
  password?: string;
}

@Injectable()
export class ExternalServicesService {
  private readonly logger = new Logger(ExternalServicesService.name);
  private readonly httpClient: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.httpClient = axios.create({
      timeout: 10000, // 10 seconds timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request/response interceptors for logging
    this.httpClient.interceptors.request.use(
      (config) => {
        this.logger.debug(`Making request to: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        this.logger.error('Request error:', error);
        return Promise.reject(error);
      }
    );

    this.httpClient.interceptors.response.use(
      (response) => {
        this.logger.debug(`Response from ${response.config.url}: ${response.status}`);
        return response;
      },
      (error) => {
        this.logger.error(`Response error from ${error.config?.url}:`, error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }
  /**
   * Register user in Motiv Traffic backend
   */
  async registerUserInMotivTraffic(userData: ExternalUserDto): Promise<ExternalServiceRegisterResult> {
    try {
      const serviceUrl = this.configService.get<string>('MOTIV_TRAFFIC_BACKEND_URL');
      if (!serviceUrl) {
        this.logger.warn('MOTIV_TRAFFIC_BACKEND_URL not configured, skipping registration');
        return { success: false };
      }

      // Check if user exists first
      this.logger.log(`Checking if user ${userData.telegramId} exists in Motiv Traffic service`);
      try {
        const checkResponse = await this.httpClient.get(`${serviceUrl}/users/${userData.telegramId}`);
        if (checkResponse.status === 200) {
          this.logger.log(`User ${userData.telegramId} already exists in Motiv Traffic, skipping registration`);
          return { success: true };
        }
      } catch (checkError) {
        // If error is 404, user doesn't exist and we should register
        if (checkError.response?.status !== 404) {
          this.logger.error(`Error checking user existence in Motiv Traffic:`, checkError.response?.data || checkError.message);
          return { success: false };
        }
        this.logger.log(`User ${userData.telegramId} not found in Motiv Traffic, proceeding with registration`);
      }

      this.logger.log(`Registering user ${userData.telegramId} in Motiv Traffic service`);
      const payload = {
        telegramId: userData.telegramId,
        username: userData.username || null,
      };

      const response = await this.httpClient.post(`${serviceUrl}/users`, payload);
      if (response.status === 200 || response.status === 201) {
        this.logger.log(`Successfully registered user ${userData.telegramId} in Motiv Traffic`);
        return {
          success: true,
          accessToken: response.data?.accessToken,
          refreshToken: response.data?.refreshToken,
        };
      } else {
        this.logger.warn(`Unexpected response status from Motiv Traffic: ${response.status}`);
        return { success: false };
      }
    } catch (error) {
      this.logger.error(`Failed to register user ${userData.telegramId} in Motiv Traffic:`, error.response?.data || error.message);
      return { success: false };
    }
  }
  /**
   * Register user in Malling backend
   */
  async registerUserInMalling(userData: ExternalUserDto): Promise<ExternalServiceRegisterResult> {
    try {
      const serviceUrl = this.configService.get<string>('MALLING_BACKEND_URL');
      if (!serviceUrl) {
        this.logger.warn('MALLING_BACKEND_URL not configured, skipping registration');
        return { success: false };
      }

      // Check if user exists first
      this.logger.log(`Checking if user ${userData.telegramId} exists in Malling service`);
      try {
        const checkResponse = await this.httpClient.get(`${serviceUrl}/users/telegram/${userData.telegramId}`);
        if (checkResponse.status === 200) {
          this.logger.log(`User ${userData.telegramId} already exists in Malling, skipping registration`);
          return { success: true };
        }
      } catch (checkError) {
        // If error is 404, user doesn't exist and we should register
        if (checkError.response?.status !== 404) {
          this.logger.error(`Error checking user existence in Malling:`, checkError.response?.data || checkError.message);
          return { success: false };
        }
        this.logger.log(`User ${userData.telegramId} not found in Malling, proceeding with registration`);
      }

      this.logger.log(`Registering user ${userData.telegramId} in Malling service`);
      const payload = {
        telegramId: userData.telegramId,
        username: userData.username || null,
      };

      const response = await this.httpClient.post(`${serviceUrl}/users`, payload);
      if (response.status === 200 || response.status === 201) {
        this.logger.log(`Successfully registered user ${userData.telegramId} in Malling`);
        return {
          success: true,
          accessToken: response.data?.accessToken,
          refreshToken: response.data?.refreshToken,
        };
      } else {
        this.logger.warn(`Unexpected response status from Malling: ${response.status}`);
        return { success: false };
      }
    } catch (error) {
      this.logger.error(`Failed to register user ${userData.telegramId} in Malling:`, error.response?.data || error.message);
      return { success: false };
    }
  }

  /**
   * Register user in Greetings backend
   */
  async registerUserInGreetings(userData: ExternalUserDto): Promise<ExternalServiceRegisterResult> {
    try {
      const serviceUrl = this.configService.get<string>('GREETINGS_BACKEND_URL');
      if (!serviceUrl) {
        this.logger.warn('GREETINGS_BACKEND_URL not configured, skipping registration');
        return { success: false };
      }

      this.logger.log(`Registering user ${userData.telegramId} in Greetings service`);
      
      // Convert telegramId to number for greetings service
      const telegramIdNumber = parseInt(userData.telegramId, 10);
      if (isNaN(telegramIdNumber)) {
        this.logger.error(`Invalid telegramId format for Greetings service: ${userData.telegramId}`);
        return { success: false };
      }

      const payload: GreetingsUserDto = {
        telegram_id: telegramIdNumber,
        username: userData.username || undefined,
        password: userData.password || undefined, // Optional, used for external services that require it
      };

      const response = await this.httpClient.post(`${serviceUrl}/auth/register`, payload);
      
      if (response.status === 200 || response.status === 201) {
        this.logger.log(`Successfully registered user ${userData.telegramId} in Greetings`);
        return {
          success: true,
          accessToken: response.data?.accessToken,
          refreshToken: response.data?.refreshToken,
        };
      } else {
        this.logger.warn(`Unexpected response status from Greetings: ${response.status}`);
        return { success: false };
      }
    } catch (error) {
      this.logger.error(`Failed to register user ${userData.telegramId} in Greetings:`, error.response?.data || error.message);
      return { success: false };
    }
  }

  /**
   * Register user in all external services
   */
  async registerUserInAllServices(userData: ExternalUserDto): Promise<{
    motivTraffic: ExternalServiceRegisterResult;
    malling: ExternalServiceRegisterResult;
    greetings: ExternalServiceRegisterResult;
  }> {
    this.logger.log(`Starting registration of user ${userData.telegramId} in all external services`);

    // Register in all services in parallel
    const [motivTrafficResult, mallingResult, greetingsResult] = await Promise.allSettled([
      this.registerUserInMotivTraffic(userData),
      this.registerUserInMalling(userData),
      this.registerUserInGreetings(userData),
    ]);

    const results = {
      motivTraffic:
        motivTrafficResult.status === 'fulfilled' && motivTrafficResult.value
          ? motivTrafficResult.value
          : { success: false },
      malling:
        mallingResult.status === 'fulfilled' && mallingResult.value
          ? mallingResult.value
          : { success: false },
      greetings:
        greetingsResult.status === 'fulfilled' && greetingsResult.value
          ? greetingsResult.value
          : { success: false },
    };

    const successCount = Object.values(results).filter(r => r.success).length;
    this.logger.log(`Registration completed for user ${userData.telegramId}. Success: ${successCount}/3 services`);

    return results;
  }
}
