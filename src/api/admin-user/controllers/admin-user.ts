export default {
  async getUsers(ctx: any) {
    try {
      const users = await strapi.entityService.findMany('plugin::users-permissions.user', {
        populate: ['role'],
        sort: { createdAt: 'desc' },
        filters: {
          role: { type: { $ne: 'client' } }
        }
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

      // Send Welcome Email
      try {
        await strapi.plugin('email').service('email').send({
          to: newUser.email,
          from: process.env.SMTP_DEFAULT_FROM,
          subject: '¡Bienvenido al Panel de Administración!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
              <h2 style="color: #4f46e5; margin-top: 0;">¡Hola, ${newUser.username}!</h2>
              <p style="font-size: 16px; color: #334155; line-height: 1.6;">
                Te han creado una cuenta de administrador en el sistema. Ya puedes acceder al panel de control para gestionar la tienda.
              </p>
              
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b; font-weight: bold; text-transform: uppercase;">Tus Credenciales de Acceso:</p>
                <p style="margin: 0 0 4px 0; font-size: 15px; color: #0f172a;"><strong>Correo:</strong> ${newUser.email}</p>
                <p style="margin: 0; font-size: 15px; color: #0f172a;"><strong>Contraseña:</strong> ${password}</p>
              </div>

              <p style="font-size: 14px; color: #64748b; line-height: 1.6; margin-bottom: 0;">
                <em>Recomendación de Seguridad: Guarda este correo o memoriza tu contraseña. En tu primer inicio de sesión, te sugerimos cambiarla por una propia.</em>
              </p>
            </div>
          `,
        });
      } catch (emailErr: any) {
        console.error('No se pudo enviar el correo de bienvenida:', emailErr.message || emailErr);
      }

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
        const orConditions = [];
        if (updateData.email) orConditions.push({ email: updateData.email });
        if (updateData.username) orConditions.push({ username: updateData.username });

        const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: {
            $or: orConditions,
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
      const user: any = await strapi.entityService.findOne('plugin::users-permissions.user', id, {
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
