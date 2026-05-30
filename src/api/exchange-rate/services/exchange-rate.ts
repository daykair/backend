import { factories } from '@strapi/strapi';
import https from 'https';

function fetchHtmlBcvIgnoreSsl(): Promise<string> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({
      rejectUnauthorized: false // <-- Ignora errores de certificados SSL auto-firmados o vencidos del BCV
    });

    const options = {
      hostname: 'www.bcv.org.ve',
      port: 443,
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      agent: agent,
      timeout: 10000 // 10 segundos de timeout
    };

    const req = https.request(options, (res) => {
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

export default factories.createCoreService('api::exchange-rate.exchange-rate', () => ({
  async updateBcvRate() {
    let rate: number | null = null;
    let rateDate: string = new Date().toISOString();
    let source = 'Manual';

    console.log('[BCV Scraper] Iniciando proceso de raspado de tasa oficial...');

    // INTENTO 1: Raspado directo de la web oficial del BCV ignorando validación de certificados SSL
    try {
      const html = await fetchHtmlBcvIgnoreSsl();
      
      // Regex ligera para ubicar la tasa del dólar en el contenedor id="dolar" robusta ante atributos/clases del tag strong
      const match = html.match(/id="dolar"[\s\S]*?<strong[^>]*?>\s*([0-9.,]+)\s*<\/strong>/i);
      if (match) {
        const rawValue = match[1].replace(',', '.').trim();
        const parsedRate = parseFloat(rawValue);
        if (!isNaN(parsedRate) && parsedRate > 0) {
          rate = parsedRate;
          source = 'BCV';
          console.log(`[BCV Scraper] Tasa raspada con éxito desde el BCV (Ignorando SSL): Bs. ${rate}`);
        }
      } else {
        throw new Error('No se encontró el contenedor id="dolar" en el HTML del BCV');
      }
    } catch (err: any) {
      console.warn(`[BCV Scraper] Intento 1 (BCV Web con SSL omitido) falló o dio timeout: ${err.message}`);
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
