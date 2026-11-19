import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { Request } from 'express';

const issuer = process.env.KEYCLOAK_ISSUER;
const jwksUri = process.env.KEYCLOAK_JWKS_URI;
const audience = process.env.KEYCLOAK_AUDIENCE ?? 'motomensajeria-api';
if (!issuer || !jwksUri) throw new Error('Faltan KEYCLOAK_ISSUER y/o KEYCLOAK_JWKS_URI en Tracking');
const jwks = createRemoteJWKSet(new URL(jwksUri));

@Injectable()
export class CadeteAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Se requiere un token Bearer');

    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], jwks, {
        issuer, audience, algorithms: ['RS256'], clockTolerance: 5,
      }));
    } catch (err) {
      if (err instanceof errors.JOSEError && err.code !== 'ERR_JWKS_TIMEOUT') {
        throw new UnauthorizedException('Token inválido o expirado');
      }
      throw new ServiceUnavailableException('No se pudo verificar el token');
    }

    if (!Array.isArray(payload.realm_access?.roles) || !payload.realm_access.roles.includes('cadete')) {
      throw new ForbiddenException('Se requiere el rol cadete');
    }
    if (typeof payload.preferred_username !== 'string' || !payload.preferred_username) {
      throw new UnauthorizedException('Token sin identidad de cadete');
    }

    // No confiar en cadeteId enviado por el cliente, ni siquiera cuando llega por el gateway.
    req.body = { ...req.body, cadeteId: payload.preferred_username };
    return true;
  }
}
