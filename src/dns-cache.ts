// DNS кэширование для оптимизации независимых параллельных рассылок
import * as dns from 'dns';

class DNSCache {
  private cache = new Map<string, { ip: string; ttl: number; timestamp: number }>();
  private readonly DEFAULT_TTL = 60000; // Увеличено до 60 секунд для стабильности независимых рассылок

  async lookup(hostname: string): Promise<string> {
    const cached = this.cache.get(hostname);
    
    if (cached && (Date.now() - cached.timestamp) < cached.ttl) {
      return cached.ip;
    }

    try {
      const result = await new Promise<string>((resolve, reject) => {
        dns.lookup(hostname, { family: 4 }, (err, address) => {
          if (err) reject(err);
          else resolve(address);
        });
      });

      // Кэшируем результат
      this.cache.set(hostname, {
        ip: result,
        ttl: this.DEFAULT_TTL,
        timestamp: Date.now()
      });

      console.log(`[DNSCache] Cached ${hostname} -> ${result} for ${this.DEFAULT_TTL}ms (INDEPENDENT MAILINGS optimized)`);
      return result;
    } catch (error) {
      console.error(`[DNSCache] Failed to resolve ${hostname}:`, error);
      throw error;
    }
  }

  clearCache() {
    this.cache.clear();
    console.log('[DNSCache] Cache cleared');
  }

  getCacheSize() {
    return this.cache.size;
  }
}

export const dnsCache = new DNSCache();

// Предварительно резолвим api.telegram.org при старте с увеличенной частотой
export async function initDNSCache() {
  try {
    await dnsCache.lookup('api.telegram.org');
    console.log('[DNSCache] Pre-cached api.telegram.org');
    
    // Периодическое обновление кэша каждые 30 секунд
    setInterval(async () => {
      try {
        await dnsCache.lookup('api.telegram.org');
        console.log('[DNSCache] Refreshed api.telegram.org cache');
      } catch (error) {
        console.error('[DNSCache] Failed to refresh cache:', error);
      }
    }, 30000);
    
  } catch (error) {
    console.error('[DNSCache] Failed to pre-cache api.telegram.org:', error);
  }
}
