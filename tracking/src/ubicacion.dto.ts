import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

// Identificadores del dominio real:
//  - cadete: preferred_username de Keycloak (admite puntos, ej. cadete.demo)
//  - envio:  UUID v7 (admite guiones)
const ID = /^[A-Za-z0-9._-]{1,40}$/;

export class UbicacionDto {
  @IsString()
  @Matches(ID)
  cadeteId!: string;

  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  /** Marca de hora del GPS (ms epoch). Si falta, se usa la hora de recepción. */
  @IsOptional()
  @IsNumber()
  ts?: number;

  /** Rumbo en grados (0-360), opcional. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  rumbo?: number;
}
