import { Injectable } from "@nestjs/common";
import { join } from "path";

// Ensure all methods are inside the class
@Injectable()
export class AvatarService {
  private readonly uploadDir: string;

  constructor() {
    this.uploadDir = join(process.cwd(), 'uploads/bot_pics');
  }

  async getBotAvatarUrl(botToken: string): Promise<string | null> {
    const botId = await this.getBotId(botToken);
    const fileId = await this.getAvatarFileId(botToken, botId);
    if (!fileId) {
      return null;
    }
    const filePath = await this.getFilePath(botToken, fileId);
    if (!filePath) {
      return null;
    }
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const savedPath = await this.downloadAndSaveAvatar(fileUrl);
    return savedPath;
  }

  async getFilePath(botToken: string, fileId: string): Promise<string | null> {
    const url = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file path from Telegram: ${response.statusText}`);
    }
    const data = await response.json();
    if (data?.ok && data.result?.file_path) {
      return data.result.file_path;
    }
    return null;
  }

  async getChannelAvatarUrl(botToken: string, channelId: string): Promise<string | null> {
    const fileId = await this.getChannelAvatarFileId(botToken, channelId);
    if (!fileId) {
      return null;
    }
    const filePath = await this.getFilePath(botToken, fileId);
    if (!filePath) {
      return null;
    }
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const savedPath = await this.downloadAndSaveAvatar(fileUrl);
    return savedPath;
  }

  /**
   * Downloads a file from the given URL and saves it to uploads/ with a random name
   * Returns the local path to the saved file
   */
  private async downloadAndSaveAvatar(fileUrl: string): Promise<string> {
    const crypto = await import('crypto');
    const fs = await import('fs/promises');
    const path = await import('path');
    const ext = path.extname(fileUrl) || '.jpg';
    const randomName = crypto.randomBytes(16).toString('hex') + ext;
    const uploadPath = path.join(process.cwd(), 'uploads', randomName);
    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new Error(`Failed to download avatar file: ${res.statusText}`);
    }
    const buffer = await res.arrayBuffer();
    await fs.writeFile(uploadPath, Buffer.from(buffer));
    // Return relative path for Docker volume mapping
    return path.join('uploads', randomName);
  }

  private async getChannelAvatarFileId(botToken: string, channelId: string): Promise<string | null> {
    const url = `https://api.telegram.org/bot${botToken}/getChat?chat_id=${channelId}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch channel info from Telegram: ${response.statusText}`);
    }
    const data = await response.json();
    if (data?.ok && data.result?.photo) {
      return data.result.photo.big_file_id;
    }
    return null;
  }

  private async getBotId(botToken: string): Promise<string> {
    const parts = botToken.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid bot token format');
    }
    return parts[0];
  }

  private async getAvatarFileId(botToken: string, botId: string): Promise<string | null> {
    // Make request to Telegram API to get user profile photos
    const url = `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${botId}&limit=1`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch avatar from Telegram: ${response.statusText}`);
    }
    const data = await response.json();
    if (
      data?.ok &&
      data.result?.total_count > 0 &&
      Array.isArray(data.result.photos) &&
      data.result.photos.length > 0 &&
      Array.isArray(data.result.photos[0]) &&
      data.result.photos[0].length > 0
    ) {
      return data.result.photos[0][0].file_id;
    }
    return null;
  }
}

