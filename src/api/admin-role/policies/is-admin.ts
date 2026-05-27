export default (policyContext: any, config: any, { strapi }: { strapi: any }) => {
  const user = policyContext.state.user;
  
  if (!user) {
    return false;
  }

  const roleType = user.role?.type || user.role?.name?.toLowerCase();
  return roleType === 'admin';
};
