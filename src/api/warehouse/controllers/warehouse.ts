import { factories } from '@strapi/strapi';
import { createAdminCrudHandlers } from '../../../utils/adminCrud';

export default factories.createCoreController('api::warehouse.warehouse', ({ strapi }) => {
  const crud = createAdminCrudHandlers(strapi, 'api::warehouse.warehouse');

  return {
    ...crud,

    async transfer(ctx) {
      try {
        const bodyData = ctx.request.body?.data || ctx.request.body;
        const { sourceWarehouseId, targetWarehouseId, items, notes } = bodyData || {};
        const performedBy = ctx.state.user?.id || null;
        const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 240) : '';

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
          const parsedQty = Number(item?.quantity);
          if (!item?.colorId || !Number.isFinite(parsedQty) || parsedQty <= 0) {
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
              select: ['id', 'documentId', 'name', 'code'],
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

            const qty = Number(Number(item.quantity).toFixed(3));
            const title = item.title || item.productName || color.product?.title || 'Producto';
            const colorName = item.selectedColor || item.colorName || color.name || 'N/A';

            if (!color.product?.isWeighed && !Number.isInteger(qty)) {
              const err: any = new Error(
                `La cantidad para '${title} (${colorName})' debe ser un número entero.`,
              );
              err.status = 400;
              throw err;
            }

            const prev = requestedByColor.get(color.id);
            requestedByColor.set(color.id, {
              color,
              qty: Number(((prev?.qty || 0) + qty).toFixed(3)),
              label: `${title} (${colorName})`,
            });

            formattedItems.push({
              productId: item.productId || color.product?.documentId || color.product?.id || null,
              colorId: color.documentId || color.id,
              title,
              colorName,
              productCode: color.product?.productCode || null,
              colorCode: color.code || null,
              unitCost: Number(color.product?.costPrice || 0),
              isWeighed: Boolean(color.product?.isWeighed),
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
          const nowIso = new Date().toISOString();
          const totalQuantity = Number(
            formattedItems
              .reduce((acc: number, item: any) => acc + Number(item.quantity || 0), 0)
              .toFixed(3),
          );
          const outReason = cleanNotes
            ? `Transferencia enviada a ${targetWh.name} (${transferCode}) — ${cleanNotes}`
            : `Transferencia enviada a ${targetWh.name} (${transferCode})`;
          const inReason = cleanNotes
            ? `Transferencia recibida desde ${sourceWh.name} (${transferCode}) — ${cleanNotes}`
            : `Transferencia recibida desde ${sourceWh.name} (${transferCode})`;

          // Crear Movimiento de Salida (OUT) en Origen
          const outMovement = await dbQuery('api::inventory-movement.inventory-movement').create({
            data: {
              type: 'OUT',
              reason: outReason,
              items: formattedItems,
              quantity: totalQuantity,
              date: nowIso,
              warehouse: sourceWh.id,
              performedBy,
            },
            transacting: trx,
          });

          // Crear Movimiento de Entrada (IN) en Destino
          const inMovement = await dbQuery('api::inventory-movement.inventory-movement').create({
            data: {
              type: 'IN',
              reason: inReason,
              items: formattedItems,
              quantity: totalQuantity,
              date: nowIso,
              warehouse: targetWh.id,
              performedBy,
            },
            transacting: trx,
          });

          return {
            transferCode,
            outMovementId: outMovement.id,
            inMovementId: inMovement.id,
            sourceWarehouseName: sourceWh.name,
            targetWarehouseName: targetWh.name,
            totalQuantity,
            notes: cleanNotes || null,
            date: nowIso,
            items: formattedItems,
          };
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

    /**
     * Registra una toma física de inventario comparando conteos reales vs stock actual del almacén
     * y generando movimientos automáticos de ajuste (IN / OUT) dentro de una transacción.
     */
    async physicalAudit(ctx) {
      try {
        const body = ctx.request.body?.data || ctx.request.body || {};
        const { warehouseId, notes, counts } = body;

        if (!warehouseId || !Array.isArray(counts) || counts.length === 0) {
          return ctx.badRequest('Debes indicar el almacén y al menos una variante contada.');
        }

        const sanitizedCounts = counts.map((entry: any) => ({
          colorId: entry?.colorId,
          countedStock: Number(entry?.countedStock),
        }));

        if (
          sanitizedCounts.some(
            (c) => !c.colorId || !Number.isFinite(c.countedStock) || c.countedStock < 0,
          )
        ) {
          return ctx.badRequest('Cada variante contada debe tener un identificador válido y conteo >= 0.');
        }

        const performedBy = ctx.state?.user?.id || null;
        const cleanNotes = String(notes || '').trim();
        const buildIdWhere = (rawId: string | number) =>
          !isNaN(Number(rawId)) && !String(rawId).includes('-')
            ? { id: Number(rawId) }
            : { documentId: String(rawId).trim() };

        const result = await strapi.db.transaction(async ({ trx }) => {
          const dbQuery = strapi.db.query as any;

          const wh = await dbQuery('api::warehouse.warehouse').findOne({
            where: buildIdWhere(warehouseId),
            select: ['id', 'documentId', 'name'],
            transacting: trx,
          });

          if (!wh) {
            const err: any = new Error('El almacén seleccionado no existe');
            err.status = 400;
            throw err;
          }

          // Deduplicar conservando el último conteo por variante si el escáner envió duplicados
          const latestByColor = new Map<string, number>();
          for (const entry of sanitizedCounts) {
            latestByColor.set(String(entry.colorId), Number(entry.countedStock.toFixed(3)));
          }

          const inItems: any[] = [];
          const outItems: any[] = [];
          const summaryAdjustments: any[] = [];

          for (const [rawColorId, counted] of latestByColor.entries()) {
            const color = await dbQuery('api::color.color').findOne({
              where: buildIdWhere(rawColorId),
              select: ['id', 'documentId', 'name'],
              populate: ['product'],
              transacting: trx,
            });

            if (!color) {
              const err: any = new Error(`Variante no encontrada (${rawColorId}).`);
              err.status = 400;
              throw err;
            }

            const whStock = await dbQuery('api::warehouse-stock.warehouse-stock').findOne({
              where: {
                color: color.id,
                warehouse: wh.id,
              },
              select: ['id', 'stock'],
              transacting: trx,
            });

            const systemStock = Number(whStock?.stock || 0);
            const delta = Number((counted - systemStock).toFixed(3));
            if (Math.abs(delta) < 0.0001) {
              continue;
            }

            const title = color.product?.title || 'Producto';
            const colorName = color.name || 'N/A';
            const movementItem = {
              productId: color.product?.id || null,
              colorId: color.documentId || color.id,
              title,
              colorName,
              quantity: Math.abs(delta),
            };

            if (delta > 0) {
              inItems.push(movementItem);
            } else {
              outItems.push(movementItem);
            }

            summaryAdjustments.push({
              colorId: color.documentId || color.id,
              productTitle: title,
              colorName,
              systemStock,
              countedStock: counted,
              delta,
            });
          }

          if (inItems.length === 0 && outItems.length === 0) {
            return {
              auditCode: null,
              warehouseName: wh.name,
              adjustedCount: 0,
              adjustments: [],
            };
          }

          const auditCode = `AUD-${Math.floor(Date.now() / 1000)}`;
          const auditReason = cleanNotes
            ? `Toma Física (${auditCode}): ${cleanNotes}`
            : `Toma Física de inventario (${auditCode})`;
          const nowIso = new Date().toISOString();

          let inMovementId: number | null = null;
          let outMovementId: number | null = null;

          if (inItems.length > 0) {
            const inQty = inItems.reduce((acc, item) => acc + Number(item.quantity || 0), 0);
            const inMov = await dbQuery('api::inventory-movement.inventory-movement').create({
              data: {
                type: 'IN',
                reason: `${auditReason} [Sobrante]`,
                items: inItems,
                quantity: inQty,
                date: nowIso,
                warehouse: wh.id,
                performedBy,
              },
              transacting: trx,
            });
            inMovementId = inMov.id;
          }

          if (outItems.length > 0) {
            const outQty = outItems.reduce((acc, item) => acc + Number(item.quantity || 0), 0);
            const outMov = await dbQuery('api::inventory-movement.inventory-movement').create({
              data: {
                type: 'OUT',
                reason: `${auditReason} [Faltante]`,
                items: outItems,
                quantity: outQty,
                date: nowIso,
                warehouse: wh.id,
                performedBy,
              },
              transacting: trx,
            });
            outMovementId = outMov.id;
          }

          return {
            auditCode,
            warehouseName: wh.name,
            adjustedCount: summaryAdjustments.length,
            inMovementId,
            outMovementId,
            adjustments: summaryAdjustments,
          };
        });

        return ctx.send({
          message:
            result.adjustedCount > 0
              ? `Auditoría aplicada (${result.adjustedCount} variantes ajustadas)`
              : 'Auditoría completada sin diferencias de stock',
          data: result,
        });
      } catch (error: any) {
        if (error?.status === 400) {
          return ctx.badRequest(error.message);
        }
        console.error('[Warehouse Physical Audit Error]:', error);
        return ctx.internalServerError(error.message || 'Error interno al registrar la toma física');
      }
    },
  };
});
