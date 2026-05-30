import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::warehouse.warehouse', ({ strapi }) => ({
  async transfer(ctx) {
    try {
      const bodyData = ctx.request.body?.data || ctx.request.body;
      const { sourceWarehouseId, targetWarehouseId, items } = bodyData || {};
      const performedBy = ctx.state.user?.id || null;

      if (!sourceWarehouseId || !targetWarehouseId || !items || !Array.isArray(items) || items.length === 0) {
        return ctx.badRequest('Missing required fields (sourceWarehouseId, targetWarehouseId, items)');
      }

      if (String(sourceWarehouseId) === String(targetWarehouseId)) {
        return ctx.badRequest('El almacén de origen y destino no pueden ser el mismo');
      }

      const result = await strapi.db.transaction(async (trx) => {
        const dbQuery = (uid: string) => (strapi.db as any).query(uid);

        const sourceWh = await dbQuery('api::warehouse.warehouse').findOne({
          where: { id: sourceWarehouseId },
          select: ['id', 'name'],
          transacting: trx,
        });

        const targetWh = await dbQuery('api::warehouse.warehouse').findOne({
          where: { id: targetWarehouseId },
          select: ['id', 'name'],
          transacting: trx,
        });

        if (!sourceWh || !targetWh) {
          throw new Error('El almacén de origen o destino no existe');
        }

        const transferCode = `TRF-${Math.floor(Date.now() / 1000)}`;
        const totalQuantity = items.reduce((acc: number, item: any) => acc + Number(item.quantity || 0), 0);

        const formattedItems = items.map((item: any) => ({
          productId: item.productId,
          colorId: item.colorId,
          title: item.title || item.productName || 'Producto',
          colorName: item.selectedColor || item.colorName || 'N/A',
          quantity: Number(item.quantity)
        }));

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
      console.error('[Warehouse Transfer Error]:', error);
      return ctx.internalServerError(error.message || 'Error interno al procesar la transferencia');
    }
  }
}));
