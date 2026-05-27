export default {
  async beforeCreate(event) {
    const { data } = event.params;
    if (!data.orderPlaced) {
      data.orderPlaced = new Date().toISOString();
    }
  },
};
