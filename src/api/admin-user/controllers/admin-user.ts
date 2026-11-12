import crypto from 'crypto';
import { isSuperAdminRole, sanitizeUserOutput } from '../../../utils/adminCrud';

const NON_STAFF_ROLE_TYPES = new Set(['client', 'cliente', 'customer', 'public', 'authenticated']);

async function resolveRoleByIdentifier(strapi: any, roleRef: any) {
  if (!roleRef) return null;
  const raw = typeof roleRef === 'object' ? (roleRef.id || roleRef.documentId) : roleRef;
  if (!raw) return null;
  const str = String(raw).trim();
  const where = /^\d+$/.test(str) ? { id: Number(str) } : { documentId: str };
  return strapi.db.query('plugin::users-permissions.role').findOne({
    where,
    select: ['id', 'name', 'type'],
  });
}

async function generateAndSendInvite(strapi: any, user: any, rawAdminUrl?: string, originHeader?: string) {
  const nonce = crypto.randomBytes(24).toString('hex');

  await strapi.db.query('plugin::users-permissions.user').update({
    where: { id: user.id },
    data: { resetPasswordToken: nonce },
  });

  const inviteToken = strapi
    .plugin('users-permissions')
    .service('jwt')
    .issue({ id: user.id, purpose: 'set-password', nonce }, { expiresIn: '48h' });

  const configuredAdminUrl = (process.env.ADMIN_URL || 'http://localhost:4321').replace(/\/$/, '');
  const allowedAdminOrigins = new Set(
    [
      configuredAdminUrl,
      ...(process.env.ADMIN_ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ].map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return '';
      }
    }).filter(Boolean),
  );
  let baseUrl = configuredAdminUrl;
  if (rawAdminUrl) {
    try {
      const parsed = new URL(String(rawAdminUrl));
      if (allowedAdminOrigins.has(parsed.origin)) {
        baseUrl = parsed.origin;
      }
    } catch {
      // ignore invalid URL and keep server-configured ADMIN_URL
    }
  }
  const inviteUrl = `${baseUrl}/set-password?token=${encodeURIComponent(inviteToken)}`;

  let emailSent = false;
  try {
    await strapi.plugin('email').service('email').send({
      to: user.email,
      from: process.env.SMTP_DEFAULT_FROM,
      subject: 'Invitación al Panel de Administración — Configura tu contraseña',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #4f46e5; margin-top: 0;">¡Hola, ${user.username}!</h2>
          <p style="font-size: 15px; color: #334155; line-height: 1.6;">
            Has sido invitado(a) a formar parte del equipo en el Panel de Administración. Para activar tu acceso, establece tu contraseña personal usando el siguiente enlace seguro:
          </p>

          <div style="text-align: center; margin: 28px 0;">
            <a href="${inviteUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 15px; padding: 12px 24px; border-radius: 8px;">
              Establecer mi Contraseña
            </a>
          </div>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 6px 0; font-size: 13px; color: #475569;"><strong>Usuario / Correo:</strong> ${user.email}</p>
            <p style="margin: 0; font-size: 12px; color: #64748b; word-break: break-all;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>${inviteUrl}</p>
          </div>

          <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 0;">
            <em>Por seguridad, este enlace temporal es de un solo uso y expirará en 48 horas.</em>
          </p>
        </div>
      `,
    });
    emailSent = true;
  } catch (emailErr: any) {
    console.error('No se pudo enviar el correo de invitación:', emailErr.message || emailErr);
  }

  return { inviteUrl, emailSent };
}

export default {
  async getUsers(ctx: any) {
    try {
      const users = await strapi.entityService.findMany('plugin::users-permissions.user', {
        populate: ['role'],
        sort: { createdAt: 'desc' },
        filters: {
          role: {
            type: {
              $notIn: ['client', 'public', 'authenticated']
            }
          }
        }
      });

      // Remove sensitive fields like password before sending
      const sanitizedUsers = users.map((u: any) => ({
        ...sanitizeUserOutput(u),
        pendingInvite: Boolean(u?.resetPasswordToken),
      }));

      return ctx.send({ users: sanitizedUsers });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al obtener usuarios.');
    }
  },

  async createUser(ctx: any) {
    const { username, email, password, role, adminUrl } = ctx.request.body;

    if (!username || !email || !role) {
      return ctx.badRequest('Faltan campos obligatorios (username, email, role).');
    }

    try {
      const targetRole = await resolveRoleByIdentifier(strapi, role);
      if (!targetRole) {
        return ctx.badRequest('El rol especificado no existe.');
      }
      if (NON_STAFF_ROLE_TYPES.has(String(targetRole.type || targetRole.name || '').toLowerCase())) {
        return ctx.badRequest('No puedes asignar roles de cliente o públicos a usuarios administrativos.');
      }
      if (isSuperAdminRole(targetRole) && !isSuperAdminRole(ctx.state?.user?.role)) {
        return ctx.forbidden('Solo un Super Administrador puede crear cuentas con rol Administrador.');
      }

      // Check if user already exists
      const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: {
          $or: [{ email: email.toLowerCase() }, { username }]
        }
      });

      if (existingUser) {
        return ctx.badRequest('Ya existe un usuario con ese correo electrónico o nombre de usuario.');
      }

      // If no password is provided, generate a high-entropy placeholder until the user sets their own via invite link
      const initialPassword =
        password && String(password).trim().length >= 6
          ? String(password)
          : crypto.randomBytes(24).toString('hex') + 'A1!';

      const newUser = await strapi.plugin('users-permissions').service('user').add({
        username: username.trim(),
        email: email.toLowerCase().trim(),
        password: initialPassword,
        role: targetRole.id,
        confirmed: true,
        provider: 'local'
      });

      const { inviteUrl, emailSent } = await generateAndSendInvite(
        strapi,
        newUser,
        adminUrl,
        ctx.request.header?.origin
      );

      // Remove sensitive info
      const safeUser = sanitizeUserOutput(newUser);

      return ctx.send({
        message: emailSent
          ? 'Usuario creado e invitación enviada por correo.'
          : 'Usuario creado. Copia el enlace temporal de invitación para enviárselo.',
        user: { ...safeUser, pendingInvite: true },
        inviteUrl,
        emailSent,
      });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al crear el usuario.');
    }
  },

  async sendInvite(ctx: any) {
    const { id } = ctx.params;
    const { adminUrl } = ctx.request.body || {};

    try {
      const user: any = await strapi.entityService.findOne('plugin::users-permissions.user', id, {
        populate: ['role'],
      });

      if (!user) {
        return ctx.notFound('Usuario no encontrado.');
      }

      if (isSuperAdminRole(user.role) && !isSuperAdminRole(ctx.state?.user?.role)) {
        return ctx.forbidden('Solo un Super Administrador puede enviar invitaciones para cuentas Administrador.');
      }

      const { inviteUrl, emailSent } = await generateAndSendInvite(
        strapi,
        user,
        adminUrl,
        ctx.request.header?.origin
      );

      return ctx.send({
        message: emailSent
          ? 'Invitación reenviada por correo exitosamente.'
          : 'Enlace temporal generado. Cópialo para compartirlo con el usuario.',
        inviteUrl,
        emailSent,
      });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al generar la invitación.');
    }
  },

  async updateUser(ctx: any) {
    const { id } = ctx.params;
    const { username, email, password, role, blocked } = ctx.request.body;
    const requesterId = ctx.state?.user?.id;

    try {
      const user: any = await strapi.entityService.findOne('plugin::users-permissions.user', id, {
        populate: ['role']
      });

      if (!user) {
        return ctx.notFound('Usuario no encontrado.');
      }

      const requesterIsSuperAdmin = isSuperAdminRole(ctx.state?.user?.role);
      const isCurrentlyAdmin = isSuperAdminRole(user.role);

      if (isCurrentlyAdmin && !requesterIsSuperAdmin) {
        return ctx.forbidden('Solo un Super Administrador puede modificar cuentas Administrador.');
      }

      const isSelf = requesterId && Number(id) === Number(requesterId);
      if (isSelf) {
        if (blocked === true) {
          return ctx.badRequest('No puedes bloquear tu propia cuenta activa.');
        }
        if (role && Number(role) !== Number(user.role?.id)) {
          return ctx.badRequest('No puedes cambiar ni degradar tu propio rol.');
        }
      }

      let resolvedRoleId: number | undefined;
      if (role !== undefined && role !== null && role !== '') {
        const nextRole = await resolveRoleByIdentifier(strapi, role);
        if (!nextRole) {
          return ctx.badRequest('El rol especificado no existe.');
        }
        if (NON_STAFF_ROLE_TYPES.has(String(nextRole.type || nextRole.name || '').toLowerCase())) {
          return ctx.badRequest('No puedes asignar roles de cliente o públicos en la gestión de personal.');
        }
        if (isSuperAdminRole(nextRole) && !requesterIsSuperAdmin) {
          return ctx.forbidden('Solo un Super Administrador puede asignar el rol Administrador.');
        }
        resolvedRoleId = nextRole.id;
      }

      // Prevent blocking or demoting the last active admin
      const isBeingBlocked = blocked === true && !user.blocked;
      const isBeingDemoted = resolvedRoleId !== undefined && Number(resolvedRoleId) !== Number(user.role?.id);

      if (isCurrentlyAdmin && (isBeingBlocked || isBeingDemoted)) {
        const activeAdminsCount = await strapi.db.query('plugin::users-permissions.user').count({
          where: {
            role: { type: 'admin' },
            blocked: { $ne: true }
          }
        });

        if (activeAdminsCount <= 1) {
          return ctx.badRequest('No se puede bloquear ni cambiar el rol del único administrador maestro activo.');
        }
      }

      const updateData: any = {};
      
      if (username) updateData.username = username;
      if (email) updateData.email = email.toLowerCase();
      if (resolvedRoleId !== undefined) updateData.role = resolvedRoleId;
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

      // If the user was blocked, immediately revoke all their refresh tokens
      if (blocked === true) {
        try {
          await strapi.service('api::refresh-token.refresh-token').revokeAllForUser(id);
        } catch (revokeErr) {
          strapi.log.error('Error revoking tokens for blocked user:', revokeErr);
        }
      }
      
      const { password: _p, resetPasswordToken: _rp, confirmationToken: _ct, ...safeUser } = updatedUser;
      
      return ctx.send({ message: 'Usuario actualizado exitosamente.', user: safeUser });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al actualizar el usuario.');
    }
  },

  async deleteUser(ctx: any) {
    const { id } = ctx.params;
    const requesterId = ctx.state?.user?.id;

    try {
      if (requesterId && Number(id) === Number(requesterId)) {
        return ctx.badRequest('No puedes eliminar tu propia cuenta mientras estás en sesión.');
      }

      const user: any = await strapi.entityService.findOne('plugin::users-permissions.user', id, {
        populate: ['role']
      });

      if (!user) {
        return ctx.notFound('Usuario no encontrado.');
      }

      // Basic protection: only super-admin can delete admin users, and prevent deleting the last admin user
      if (isSuperAdminRole(user.role)) {
        if (!isSuperAdminRole(ctx.state?.user?.role)) {
          return ctx.forbidden('Solo un Super Administrador puede eliminar cuentas Administrador.');
        }
        const adminUsersCount = await strapi.db.query('plugin::users-permissions.user').count({
          where: { role: { type: 'admin' } }
        });

        if (adminUsersCount <= 1) {
          return ctx.badRequest('No se puede eliminar el único usuario administrador maestro del sistema.');
        }
      }

      try {
        await strapi.service('api::refresh-token.refresh-token').revokeAllForUser(id);
      } catch (revokeErr) {
        strapi.log.error('Error revoking tokens before deleting user:', revokeErr);
      }

      await strapi.entityService.delete('plugin::users-permissions.user', id);

      return ctx.send({ message: 'Usuario eliminado correctamente.' });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al eliminar el usuario.');
    }
  }
};
