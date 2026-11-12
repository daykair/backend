/**
 * Helpers para órdenes públicas del storefront, portal de clientes y correos transaccionales.
 */

const ALLOWED_PUBLIC_METHODS = new Set(['pago-movil', 'binance', 'zelle', 'cashea']);
const ALLOWED_DELIVERY_METHODS = new Set(['pickup', 'delivery', 'envio']);

export function normalizePhoneDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

export function normalizeComparablePhone(value: unknown): string {
  const digits = normalizePhoneDigits(value);
  if (digits.length > 10) return digits.slice(-10);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function isValidPublicMethod(method: unknown): boolean {
  return ALLOWED_PUBLIC_METHODS.has(String(method || '').trim());
}

export function isValidDeliveryMethod(deliveryMethod: unknown): boolean {
  return ALLOWED_DELIVERY_METHODS.has(String(deliveryMethod || '').trim());
}

export function isPayablePublicStatus(status: unknown): boolean {
  const s = String(status || '').trim();
  return (
    s === 'pending' ||
    s === 'Pendiente por pago' ||
    s === 'failed_verification' ||
    s === 'verification_failed'
  );
}

/**
 * Resuelve el precio unitario base (detal o mayor) considerando sobreescritura opcional por talla.
 */
export function getEffectiveVariantPrice(
  product: any,
  size?: any,
  priceType: 'detal' | 'mayor' = 'detal',
): number {
  if (priceType === 'mayor') {
    const sizeWholesale = size?.wholesalePrice;
    if (sizeWholesale !== undefined && sizeWholesale !== null && sizeWholesale !== '') {
      const parsed = Number(sizeWholesale);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return Number(product?.wholesalePrice || 0);
  }

  const sizePrice = size?.price;
  if (sizePrice !== undefined && sizePrice !== null && sizePrice !== '') {
    const parsed = Number(sizePrice);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return Number(product?.price || 0);
}

/**
 * Calcula el porcentaje máximo de descuento aplicable desde producto, color, talla y categorías.
 */
export function calculateEffectiveDiscountPct(product: any, color?: any, size?: any): number {
  const prodDiscount =
    product?.isDiscounted === false
      ? 0
      : Math.min(100, Math.max(0, Number(product?.discount || 0)));
  const colorDiscount =
    color?.isDiscounted === false
      ? 0
      : Math.min(100, Math.max(0, Number(color?.discount || 0)));
  const sizeDiscount =
    size?.isDiscounted === false
      ? 0
      : Math.min(100, Math.max(0, Number(size?.discount || 0)));
  const catDiscounts = Array.isArray(product?.categories)
    ? product.categories.map((cat: any) =>
        Math.min(100, Math.max(0, Number(cat?.discount ?? cat?.Discount ?? 0))),
      )
    : [];

  return Math.max(prodDiscount, colorDiscount, sizeDiscount, ...catDiscounts, 0);
}

/**
 * Elimina campos internos sensibles (costos, notas internas, staff) antes de responder al storefront.
 */
export function sanitizePublicOrder(order: any, options?: { includeCustomerPii?: boolean }) {
  if (!order) return null;

  const rawItems = Array.isArray(order.orderItems) ? order.orderItems : [];
  const orderItems = rawItems.map((item: any) => ({
    productId: item.productId,
    colorId: item.colorId,
    sizeId: item.sizeId || null,
    sizeName: item.sizeName || '',
    quantity: Number(item.quantity || 0),
    returnedQuantity: Number(item.returnedQuantity || 0),
    unitPrice: Number(item.unitPrice || 0),
    title: item.title || item.productName || '',
    productName: item.productName || item.title || '',
    selectedColor: item.selectedColor || item.colorName || '',
    colorName: item.colorName || item.selectedColor || '',
    productImage: item.productImage || null,
  }));

  const safeOrder: Record<string, any> = {
    id: order.id,
    documentId: order.documentId,
    slug: order.slug || order.documentId,
    orderStatus: order.orderStatus,
    orderTotal: Number(order.orderTotal || 0),
    amountPaid: Number(order.amountPaid || 0),
    orderType: order.orderType || 'regular',
    method: order.method || '',
    deliveryMethod: order.deliveryMethod || '',
    option: order.option || '',
    trackingNumber: order.trackingNumber || '',
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    orderItems,
  };

  if (options?.includeCustomerPii) {
    safeOrder.clientName = order.clientName || '';
    safeOrder.phone = order.phone || '';
    safeOrder.email = order.email || '';
    safeOrder.city = order.city || '';
    safeOrder.state = order.state || '';
    safeOrder.adress = order.adress || '';
    safeOrder.paymentReference = order.paymentReference || '';
  }

  return safeOrder;
}

/**
 * Verifica coincidencia de correo real o teléfono del cliente para rastreo de pedidos de invitados.
 */
export function matchesOrderVerification(order: any, verification: string): boolean {
  const input = String(verification || '').trim();
  if (!input || !order) return false;

  if (input.includes('@')) {
    const orderEmail = String(order.email || '').trim().toLowerCase();
    if (!orderEmail || orderEmail.endsWith('@cliente.local')) return false;
    return orderEmail === input.toLowerCase();
  }

  const inputPhone = normalizeComparablePhone(input);
  const orderPhone = normalizeComparablePhone(order.phone);
  if (inputPhone.length < 7 || orderPhone.length < 7) return false;
  return inputPhone === orderPhone;
}

export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Envía notificación por correo al cliente al confirmar pago o entregar/despachar un pedido.
 * Es no-bloqueante: si SMTP no está configurado o falla, registra advertencia sin abortar la orden.
 */
export async function sendOrderStatusNotification(
  strapi: any,
  order: any,
  nextStatus: string,
  previousStatus?: string | null,
): Promise<void> {
  if (!order || !nextStatus || nextStatus === previousStatus) return;
  if (nextStatus !== 'payment_confirmed' && nextStatus !== 'delivered') return;
  if (!process.env.SMTP_USERNAME || !process.env.SMTP_PASSWORD) return;

  const recipient = String(order.email || '').trim();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || /@cliente\.local$/i.test(recipient)) {
    return;
  }

  try {
    const companySetting = await (strapi.documents('api::company-setting.company-setting' as any) as any)
      .findFirst()
      .catch(() => null);
    const brandName = escapeHtml(companySetting?.commercialName || 'Tienda Online');
    const orderRef = escapeHtml(order.slug || order.documentId || order.id);
    const clientName = escapeHtml(order.clientName || 'Cliente');
    const totalStr = Number(order.orderTotal || 0).toFixed(2);
    const shippingAgency = escapeHtml(order.option || '');
    const tracking = escapeHtml(order.trackingNumber || '');

    const isConfirmed = nextStatus === 'payment_confirmed';
    const subject = isConfirmed
      ? `${companySetting?.commercialName || 'Tienda Online'}: Pago confirmado para tu pedido #${order.slug || order.id}`
      : `${companySetting?.commercialName || 'Tienda Online'}: Tu pedido #${order.slug || order.id} ha sido despachado`;

    const headline = isConfirmed
      ? '¡Tu pago ha sido confirmado!'
      : '¡Tu pedido ha sido despachado / entregado!';
    const intro = isConfirmed
      ? 'Hemos verificado tu pago exitosamente y estamos preparando tu orden.'
      : 'Tu pedido ha cambiado a estado entregado/despachado.';

    const trackingHtml = tracking
      ? `<div style="margin:16px 0;padding:12px;border:1px solid #d1d5db;border-radius:8px;background:#f9fafb;">
           <p style="margin:0 0 4px;font-weight:bold;">Información de envío</p>
           ${shippingAgency ? `<p style="margin:0 0 4px;">Empresa de envío: <strong>${shippingAgency}</strong></p>` : ''}
           <p style="margin:0;">Número de guía / tracking: <strong>${tracking}</strong></p>
         </div>`
      : shippingAgency
      ? `<p style="margin:12px 0;">Empresa / método de envío: <strong>${shippingAgency}</strong></p>`
      : '';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;color:#111827;">
        <h2 style="margin:0 0 8px;">${brandName}</h2>
        <h3 style="margin:0 0 16px;color:#059669;">${headline}</h3>
        <p>Hola <strong>${clientName}</strong>,</p>
        <p>${intro}</p>
        <p>Pedido: <strong>#${orderRef}</strong><br/>Total de la orden: <strong>$${totalStr} USD</strong></p>
        ${trackingHtml}
        <p style="margin-top:20px;font-size:13px;color:#6b7280;">
          Puedes consultar el estado de tu pedido en la sección "Mis Pedidos" de nuestra tienda.
        </p>
      </div>
    `;

    const emailPlugin = strapi.plugin('email');
    if (emailPlugin?.service('email')?.send) {
      await emailPlugin.service('email').send({
        to: recipient,
        subject,
        html,
        text: `${headline} - Pedido #${order.slug || order.id} ($${totalStr})${
          order.trackingNumber ? ` | Tracking: ${order.trackingNumber}` : ''
        }`,
      });
    }
  } catch (err: any) {
    console.warn('[OrderEmail] No se pudo enviar correo transaccional:', err?.message || err);
  }
}

export async function resolveCustomerFromContext(strapi: any, ctx: any) {
  const authHeader = String(ctx.request.header?.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const cookieToken = ctx.cookies?.get('store_customer_jwt') || '';
  const token = bearer || cookieToken;
  if (!token) return null;

  try {
    const decoded = await strapi.plugin('users-permissions').service('jwt').verify(token);
    if (!decoded?.id) return null;
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: decoded.id },
      select: ['id', 'blocked'],
      populate: ['role'],
    });
    if (!user || user.blocked) return null;
    return user;
  } catch {
    return null;
  }
}

export async function validatePublicOrderPayableAccess(
  strapi: any,
  identifier: string,
  ctx: any,
) {
  const clean = String(identifier || '').trim();
  if (!clean) {
    const err: any = new Error('Identificador de pedido requerido');
    err.status = 400;
    throw err;
  }

  const order = await strapi.db.query('api::order.order').findOne({
    where: {
      $or: [{ slug: clean }, { documentId: clean }],
    },
    populate: {
      customer: {
        select: ['id', 'email'],
      },
    },
  });

  if (!order) {
    const err: any = new Error('Pedido no encontrado');
    err.status = 404;
    throw err;
  }

  if (!isPayablePublicStatus(order.orderStatus)) {
    const err: any = new Error('Este pedido ya no admite envío o modificación de comprobante de pago.');
    err.status = 400;
    throw err;
  }

  const attachedEmail = String(order.customer?.email || '').trim().toLowerCase();
  const hasRegisteredCustomer = Boolean(order.customer?.id) && !attachedEmail.endsWith('@cliente.local');

  if (hasRegisteredCustomer) {
    const loggedCustomer = await resolveCustomerFromContext(strapi, ctx);
    if (!loggedCustomer || Number(loggedCustomer.id) !== Number(order.customer.id)) {
      const err: any = new Error('Debes iniciar sesión con la cuenta propietaria de este pedido.');
      err.status = 403;
      throw err;
    }
  }

  return order;
}

