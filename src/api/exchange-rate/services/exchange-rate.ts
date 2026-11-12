import { factories } from '@strapi/strapi';
import https from 'https';

export function parseBcvRateNumber(raw: string): number {
  const cleaned = String(raw || '').replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return NaN;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized = cleaned;
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // Formato venezolano/europeo: 1.234,5678 -> quitar puntos de miles, coma a punto decimal
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato anglosajón: 1,234.5678 -> quitar comas de miles
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    // Múltiples comas => miles, una coma => decimal
    const commaCount = (cleaned.match(/,/g) || []).length;
    normalized = commaCount > 1 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  } else if (lastDot !== -1) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      normalized = cleaned.replace(/\./g, '');
    }
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(4)) : NaN;
}

function fetchHtmlBcv(rejectUnauthorized: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized });

    const options = {
      hostname: 'www.bcv.org.ve',
      port: 443,
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
        'Accept-Language': 'es-VE,es;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      agent,
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume();
        reject(new Error(`BCV respondió con estado HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de conexión con el BCV'));
    });

    req.end();
  });
}

function isOutlierRate(candidate: number, referenceRate: number | null): boolean {
  if (!Number.isFinite(candidate) || candidate <= 0) return true;
  if (!referenceRate || !Number.isFinite(referenceRate) || referenceRate <= 0) return false;
  return candidate < referenceRate * 0.25 || candidate > referenceRate * 4;
}

export default factories.createCoreService('api::exchange-rate.exchange-rate', () => ({
  async updateBcvRate() {
    let rate: number | null = null;
    let rateDate: string = new Date().toISOString();
    let source = 'Manual';

    const cachedRateRecord = await global.strapi
      .documents('api::exchange-rate.exchange-rate')
      .findFirst()
      .catch(() => null);
    const previousRate =
      cachedRateRecord?.rate && Number(cachedRateRecord.rate) > 0
        ? Number(cachedRateRecord.rate)
        : null;

    console.log('[BCV Scraper] Iniciando proceso de obtención de tasa oficial...');

    // INTENTO 1: Raspado directo de la web oficial del BCV (TLS verificado primero; respaldo TLS solo ante error de cadena CA del BCV)
    try {
      let html: string;
      try {
        html = await fetchHtmlBcv(true);
      } catch (tlsErr: any) {
        const msg = String(tlsErr?.code || tlsErr?.message || '');
        const isCertError =
          msg.includes('CERT') ||
          msg.includes('UNABLE_TO_VERIFY') ||
          msg.includes('SELF_SIGNED') ||
          msg.includes('certificate');
        if (!isCertError || process.env.ALLOW_INSECURE_BCV_TLS === 'false') {
          throw tlsErr;
        }
        console.warn('[BCV Scraper] Certificados SSL del BCV no confiables en este host; reintentando conexión de respaldo sin verificación CA.');
        html = await fetchHtmlBcv(false);
      }

      const match = html.match(/id="dolar"[\s\S]*?<strong[^>]*?>\s*([0-9.,]+)\s*<\/strong>/i);
      if (!match) {
        throw new Error('No se encontró el contenedor id="dolar" en el HTML del BCV');
      }

      const parsedRate = parseBcvRateNumber(match[1]);
      if (isNaN(parsedRate) || parsedRate <= 0) {
        throw new Error(`Valor raspado inválido del BCV: "${match[1]}"`);
      }

      if (isOutlierRate(parsedRate, previousRate)) {
        console.warn(
          `[BCV Scraper] Tasa raspada (${parsedRate}) desviada respecto a la tasa previa (${previousRate}); contrastando con DolarApi.`,
        );
      } else {
        rate = parsedRate;
        source = 'BCV';
        console.log(`[BCV Scraper] Tasa raspada con éxito desde el BCV: Bs. ${rate}`);
      }
    } catch (err: any) {
      console.warn(`[BCV Scraper] Intento 1 (BCV Web) falló: ${err.message}`);
    }

    // INTENTO 2 (Fallback): Consulta a DolarApi oficial
    if (!rate) {
      try {
        console.log('[BCV Scraper] Intentando consultar mirror alternativo (dolarapi.com)...');
        const response = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          const data: any = await response.json();
          const parsedRate = Number(data.promedio);
          if (!isNaN(parsedRate) && parsedRate > 0) {
            rate = parsedRate;
            source = 'DolarApi';
            if (data.fechaActualizacion) {
              rateDate = data.fechaActualizacion;
            }
            console.log(`[BCV Scraper] Tasa obtenida con éxito desde DolarApi: Bs. ${rate}`);
          }
        }
      } catch (err: any) {
        console.error(`[BCV Scraper] Intento 2 (DolarApi) también falló: ${err.message}`);
      }
    }

    // INTENTO 3 (Último recurso / Fallback de Emergencia): Mantener tasa previa o usar fallback histórico
    if (!rate) {
      console.warn('[BCV Scraper] Todos los intentos de obtención automática fallaron. Buscando tasa previa en la base de datos...');
      const existing = await global.strapi.documents('api::exchange-rate.exchange-rate').findFirst();
      if (existing && existing.rate) {
        console.log(`[BCV Scraper] Manteniendo la última tasa conocida en base de datos: Bs. ${existing.rate}`);
        return existing;
      } else {
        // Fallback absoluto por si la base de datos está totalmente vacía en el primer inicio
        rate = 36.50; 
        source = 'Sistema (Fallback)';
        console.warn(`[BCV Scraper] Base de datos vacía. Usando tasa de resguardo absoluta: Bs. ${rate}`);
      }
    }

    // Guardar o actualizar la tasa en el registro único usando el API de Documentos de Strapi 5
    const existingRecord = await global.strapi.documents('api::exchange-rate.exchange-rate').findFirst();
    let result;

    if (existingRecord) {
      result = await global.strapi.documents('api::exchange-rate.exchange-rate').update({
        documentId: existingRecord.documentId,
        data: {
          rate,
          rateDate,
          source
        }
      });
      console.log(`[BCV Scraper] Registro de tasa actualizado en BD vía Documentos (DocID: ${existingRecord.documentId})`);
    } else {
      result = await global.strapi.documents('api::exchange-rate.exchange-rate').create({
        data: {
          rate,
          rateDate,
          source
        }
      });
      console.log(`[BCV Scraper] Nuevo registro de tasa creado en BD vía Documentos (DocID: ${result.documentId})`);
    }

    return result;
  }
}));
