import { factories } from '@strapi/strapi';
import { createAdminCrudHandlers } from '../../../utils/adminCrud';

export default factories.createCoreController('api::warehouse.warehouse', ({ strapi }) => {
  const crud = createAdminCrudHandlers(strapi, 'api::warehouse.warehouse');

  return {
    ...crud,

    async transfer(ctx) {
      try {
        const bodyData = ctx.request.body?.data || ctx.request.body;
        const { sourceWarehouseId, targetWarehouseId, items } = bodyData || {};
        const performedBy = ctx.state.user?.id || null;

        if (
          !sourceWarehouseId ||
          !targetWarehouseId ||
          !items ||
          !Array.isArray(items) ||
          items.length === 0
        ) {
          return ctx.badRequest('Missing required fields (sourceWarehouseId, targetWarehouseId, items)');
        }

        if (String(sourceWarehouseId) === String(targetWarehouseId)) {
          return ctx.badRequest('El almacén de origen y destino no pueden ser el mismo');
        }

        for (const item of items) {
          if (!item?.colorId || !(Number(item?.quantity) > 0)) {
            return ctx.badRequest('Todos los ítems de transferencia deben incluir variante y cantidad mayor a 0.');
          }
        }

        const result = await strapi.db.transaction(async (trx) => {
          const dbQuery = (uid: string) => (strapi.db as any).query(uid);
          const buildIdWhere = (rawId: string | number) =>
            /^\d+$/.test(String(rawId).trim())
              ? { id: Number(rawId) }
              : { documentId: String(rawId).trim() };

          const sourceWh = await dbQuery('api::warehouse.warehouse').findOne({
            where: buildIdWhere(sourceWarehouseId),
            select: ['id', 'documentId', 'name'],
            transacting: trx,
          });

          const targetWh = await dbQuery('api::warehouse.warehouse').findOne({
            where: buildIdWhere(targetWarehouseId),
            select: ['id', 'documentId', 'name'],
            transacting: trx,
          });

          if (!sourceWh || !targetWh) {
            const err: any = new Error('El almacén de origen o destino no existe');
            err.status = 400;
            throw err;
          }

          if (sourceWh.id === targetWh.id) {
            const err: any = new Error('El almacén de origen y destino no pueden ser el mismo');
            err.status = 400;
            throw err;
          }

          // Resolver variantes y validar stock acumulado en almacén origen antes de registrar movimientos
          const requestedByColor = new Map<
            number,
            { color: any; qty: number; label: string }
          >();
          const formattedItems: any[] = [];

          for (const item of items) {
            const color = await dbQuery('api::color.color').findOne({
              where: buildIdWhere(item.colorId),
              select: ['id', 'documentId', 'name'],
              populate: ['product'],
              transacting: trx,
            });

            if (!color) {
              const err: any = new Error(
                `La variante seleccionada (${item.selectedColor || item.colorName || item.colorId}) ya no existe.`,
              );
              err.status = 400;
              throw err;
            }

            const qty = Number(item.quantity);
            const title = item.title || item.productName || color.product?.title || 'Producto';
            const colorName = item.selectedColor || item.colorName || color.name || 'N/A';

            const prev = requestedByColor.get(color.id);
            requestedByColor.set(color.id, {
              color,
              qty: (prev?.qty || 0) + qty,
              label: `${title} (${colorName})`,
            });

            formattedItems.push({
              productId: item.productId || color.product?.id || null,
              colorId: color.documentId || color.id,
              title,
              colorName,
              quantity: qty,
            });
          }

          for (const [colorNumericId, info] of requestedByColor.entries()) {
            const whStock = await dbQuery('api::warehouse-stock.warehouse-stock').findOne({
              where: {
                color: colorNumericId,
                warehouse: sourceWh.id,
              },
              select: ['id', 'stock'],
              transacting: trx,
            });
            const available = Number(whStock?.stock || 0);
            if (available < info.qty) {
              const err: any = new Error(
                `Stock insuficiente en '${sourceWh.name}' para '${info.label}'. Solicitado: ${info.qty}, Disponible: ${available}.`,
              );
              err.status = 400;
              throw err;
            }
          }

          const transferCode = `TRF-${Math.floor(Date.now() / 1000)}`;
          const totalQuantity = formattedItems.reduce(
            (acc: number, item: any) => acc + Number(item.quantity || 0),
            0,
          );

          // Crear Movimiento de Salida (OUT) en Origen
          const outMovement = await dbQuery('api::inventory-movement.inventory-movement').create({
            data: {
              type: 'OUT',
              reason: `Transferencia enviada a ${targetWh.name} (${transferCode})`,
              items: formattedItems,
              quantity: totalQuantity,
              date: new Date().toISOString(),
              warehouse: sourceWh.id,
              performedBy,
            },
            transacting: trx,
          });

          // Crear Movimiento de Entrada (IN) en Destino
          const inMovement = await dbQuery('api::inventory-movement.inventory-movement').create({
            data: {
              type: 'IN',
              reason: `Transferencia recibida desde ${sourceWh.name} (${transferCode})`,
              items: formattedItems,
              quantity: totalQuantity,
              date: new Date().toISOString(),
              warehouse: targetWh.id,
              performedBy,
            },
            transacting: trx,
          });

          return { transferCode, outMovementId: outMovement.id, inMovementId: inMovement.id };
        });

        return ctx.send({ message: 'Transferencia completada', data: result });
      } catch (error: any) {
        if (error?.status === 400) {
          return ctx.badRequest(error.message);
        }
        console.error('[Warehouse Transfer Error]:', error);
        return ctx.internalServerError(error.message || 'Error interno al procesar la transferencia');
      }
    },
  };
});
