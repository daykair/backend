export default {
  async getUsers(ctx: any) {
    try {
      const users = await strapi.entityService.findMany('plugin::users-permissions.user', {
        populate: ['role'],
        sort: { createdAt: 'DESC' }
      });

      // Remove sensitive fields like password before sending
      const sanitizedUsers = users.map((u: any) => {
        const { password, resetPasswordToken, confirmationToken, ...safeUser } = u;
        return safeUser;
      });

      return ctx.send({ users: sanitizedUsers });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al obtener usuarios.');
    }
  },

  async createUser(ctx: any) {
    const { username, email, password, role } = ctx.request.body;

    if (!username || !email || !password || !role) {
      return ctx.badRequest('Faltan campos obligatorios (username, email, password, role).');
    }

    try {
      // Check if user already exists
      const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: {
          $or: [{ email: email.toLowerCase() }, { username }]
        }
      });

      if (existingUser) {
        return ctx.badRequest('Ya existe un usuario con ese correo electrónico o nombre de usuario.');
      }

      // We use the plugin service so that it hashes the password properly
      const newUser = await strapi.plugin('users-permissions').service('user').add({
        username,
        email: email.toLowerCase(),
        password,
        role,
        confirmed: true, // Auto confirm for admin created users
        provider: 'local'
      });

      // Remove sensitive info
      const { password: _p, ...safeUser } = newUser;

      return ctx.send({ message: 'Usuario creado exitosamente.', user: safeUser });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al crear el usuario.');
    }
  },

  async updateUser(ctx: any) {
    const { id } = ctx.params;
    const { username, email, password, role, blocked } = ctx.request.body;

    try {
      const user = await strapi.entityService.findOne('plugin::users-permissions.user', id, {
        populate: ['role']
      });

      if (!user) {
        return ctx.notFound('Usuario no encontrado.');
      }

      const updateData: any = {};
      
      if (username) updateData.username = username;
      if (email) updateData.email = email.toLowerCase();
      if (role) updateData.role = role;
      if (typeof blocked === 'boolean') updateData.blocked = blocked;
      if (password) updateData.password = password;

      // Check if email or username is taken by another user
      if (updateData.email || updateData.username) {
        const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: {
            $or: [
              updateData.email ? { email: updateData.email } : {},
              updateData.username ? { username: updateData.username } : {}
            ],
            id: { $ne: id }
          }
        });

        if (existingUser) {
          return ctx.badRequest('El correo o nombre de usuario ya está en uso por otra cuenta.');
        }
      }

      // Use the plugin service edit function to handle password hashing
      const updatedUser = await strapi.plugin('users-permissions').service('user').edit(id, updateData);
      
      const { password: _p, ...safeUser } = updatedUser;
      
      return ctx.send({ message: 'Usuario actualizado exitosamente.', user: safeUser });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al actualizar el usuario.');
    }
  },

  async deleteUser(ctx: any) {
    const { id } = ctx.params;

    try {
      const user = await strapi.entityService.findOne('plugin::users-permissions.user', id, {
        populate: ['role']
      });

      if (!user) {
        return ctx.notFound('Usuario no encontrado.');
      }

      // Basic protection: prevent deleting the last admin user
      if (user.role?.type?.toLowerCase() === 'admin') {
        const adminUsersCount = await strapi.db.query('plugin::users-permissions.user').count({
          where: { role: { type: 'admin' } }
        });

        if (adminUsersCount <= 1) {
          return ctx.badRequest('No se puede eliminar el único usuario administrador maestro del sistema.');
        }
      }

      await strapi.entityService.delete('plugin::users-permissions.user', id);

      return ctx.send({ message: 'Usuario eliminado correctamente.' });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al eliminar el usuario.');
    }
  }
};
