import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsString, Matches, MaxLength, ValidateIf,
  ValidateNested, validateSync,
} from 'class-validator';
import { Prisma } from '../../generated/prisma/client';
import type { Locale } from '../../generated/prisma/enums';

export const SPECIFICATION_GROUPS = [
  'material', 'material_colour', 'fineness', 'gold_karat', 'gemstone',
  'stone_colour', 'stone_grade', 'stone_clarity', 'stone_shape',
  'pearl_type', 'finish', 'construction_detail',
] as const;
export type SpecificationGroup = typeof SPECIFICATION_GROUPS[number];

export class SpecificationMaterialDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  material_code: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  colour_code: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  fineness_code: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  gold_karat_code: string | null = null;
}

export class SpecificationStoneDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  stone_code: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^\d{1,9}(?:\.\d{1,4})?$/)
  carat_weight: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  colour_code: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  grade_code: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  clarity_code: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/)
  shape_code: string | null = null;
}

export class PieceSpecificationsDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^\d{1,9}(?:\.\d{1,3})?$/)
  weight_g: string | null = null;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SpecificationMaterialDto)
  materials: SpecificationMaterialDto[] = [];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SpecificationStoneDto)
  stone_groups: SpecificationStoneDto[] = [];

  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/, { each: true })
  pearl_type_codes: string[] = [];

  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/, { each: true })
  finish_codes: string[] = [];

  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/, { each: true })
  construction_detail_codes: string[] = [];

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @Matches(/\S/)
  @MaxLength(3000)
  construction_details_bg: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @Matches(/\S/)
  @MaxLength(3000)
  construction_details_en: string | null = null;
}

export class SpecificationComponentDto extends PieceSpecificationsDto {
  @Matches(/^[A-Za-z0-9_-]{1,80}$/)
  key!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(250)
  name_bg!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(250)
  name_en!: string;
}

export class JewellerySpecificationsDto extends PieceSpecificationsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SpecificationComponentDto)
  components: SpecificationComponentDto[] = [];
}

export class SpecificationStoneFilterDto extends SpecificationStoneDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^\d{1,9}(?:\.\d{1,4})?$/)
  carat_min: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^\d{1,9}(?:\.\d{1,4})?$/)
  carat_max: string | null = null;
}

export class SpecificationFilterDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^\d{1,9}(?:\.\d{1,3})?$/)
  weight_g_min: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^\d{1,9}(?:\.\d{1,3})?$/)
  weight_g_max: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @Matches(/^[A-Za-z0-9_-]{1,80}$/)
  component_key: string | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => SpecificationMaterialDto)
  material: SpecificationMaterialDto | null = null;

  @ValidateIf((_, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => SpecificationStoneFilterDto)
  stone: SpecificationStoneFilterDto | null = null;

  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/, { each: true })
  pearl_type_codes: string[] = [];

  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/, { each: true })
  finish_codes: string[] = [];

  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^[A-Za-z0-9._-]{1,80}$/, { each: true })
  construction_detail_codes: string[] = [];
}

export class SpecificationQueryDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') throw new BadRequestException();
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch (error) {
      if (error instanceof SyntaxError) throw new BadRequestException();
      throw error;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException();
    }
    return plainToInstance(SpecificationFilterDto, parsed);
  })
  @ValidateNested()
  specification_filter?: SpecificationFilterDto;
}

export async function validateSpecificationFilter(
  tx: Prisma.TransactionClient, filter: SpecificationFilterDto | undefined,
) {
  if (!filter) return;
  for (const [minimum, maximum] of [
    [filter.weight_g_min, filter.weight_g_max],
    [filter.stone?.carat_min, filter.stone?.carat_max],
  ]) {
    if (minimum != null && maximum != null &&
      new Prisma.Decimal(minimum).greaterThan(maximum)) invalidSpecifications('specification_filter');
  }
  const requested = new JewellerySpecificationsDto();
  requested.materials = filter.material ? [filter.material] : [];
  requested.stone_groups = filter.stone ? [filter.stone] : [];
  requested.pearl_type_codes = filter.pearl_type_codes;
  requested.finish_codes = filter.finish_codes;
  requested.construction_detail_codes = filter.construction_detail_codes;
  await specificationDictionary(tx, [requested]);
}

export function specificationFilterMatches(
  value: JewellerySpecificationsDto | null, filter: SpecificationFilterDto | undefined,
): boolean {
  if (!filter) return true;
  const inRange = (value: string | null, min: string | null, max: string | null) =>
    (min === null && max === null) || (value !== null &&
      (min === null || new Prisma.Decimal(value).greaterThanOrEqualTo(min)) &&
      (max === null || new Prisma.Decimal(value).lessThanOrEqualTo(max)));
  if (!value) {
    return filter.weight_g_min === null && filter.weight_g_max === null &&
      filter.component_key === null && filter.material === null && filter.stone === null &&
      !filter.pearl_type_codes.length && !filter.finish_codes.length &&
      !filter.construction_detail_codes.length;
  }
  if (!inRange(value.weight_g, filter.weight_g_min, filter.weight_g_max)) return false;
  const pieces = filter.component_key === null ? specificationPieces(value)
    : value.components.filter(component => component.key === filter.component_key);
  const stoneFilter = filter.stone;
  const anyCode = (requested: string[], present: string[]) =>
    !requested.length || requested.some(code => present.includes(code));
  return pieces.some(piece =>
    (!filter.material || piece.materials.some(material =>
      (['material_code', 'colour_code', 'fineness_code', 'gold_karat_code'] as const)
        .every(field => filter.material?.[field] == null || material[field] === filter.material[field]))) &&
    (!stoneFilter || piece.stone_groups.some(stone =>
      (['stone_code', 'colour_code', 'grade_code', 'clarity_code', 'shape_code'] as const)
        .every(field => stoneFilter[field] === null || stone[field] === stoneFilter[field]) &&
      (stoneFilter.carat_weight === null || (stone.carat_weight !== null &&
        new Prisma.Decimal(stone.carat_weight).equals(stoneFilter.carat_weight))) &&
      inRange(stone.carat_weight, stoneFilter.carat_min, stoneFilter.carat_max))) &&
    anyCode(filter.pearl_type_codes, piece.pearl_type_codes) &&
    anyCode(filter.finish_codes, piece.finish_codes) &&
    anyCode(filter.construction_detail_codes, piece.construction_detail_codes),
  );
}

export function specificationPieces(value: JewellerySpecificationsDto): PieceSpecificationsDto[] {
  return [value, ...value.components];
}

export function parseSpecifications(value: unknown): JewellerySpecificationsDto | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) invalidSpecifications();
  const result = plainToInstance(JewellerySpecificationsDto, value);
  if (validateSync(result, { whitelist: true, forbidNonWhitelisted: true }).length) {
    invalidSpecifications();
  }
  if (new Set(result.components.map(component => component.key)).size !== result.components.length) {
    invalidSpecifications('specifications.components');
  }
  for (const piece of specificationPieces(result)) {
    if (piece.weight_g !== null) piece.weight_g = decimalValue(piece.weight_g);
    for (const stone of piece.stone_groups) {
      if (stone.carat_weight !== null) stone.carat_weight = decimalValue(stone.carat_weight);
    }
    for (const codes of [piece.pearl_type_codes, piece.finish_codes, piece.construction_detail_codes]) {
      if (new Set(codes).size !== codes.length) invalidSpecifications();
    }
  }
  return result;
}

export function readSpecifications(value: unknown): JewellerySpecificationsDto | null {
  try {
    return parseSpecifications(value);
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    throw new ServiceUnavailableException({
      code: 'SPECIFICATIONS_INVALID', message_key: 'errors.configuration_unavailable',
    });
  }
}

export async function readSpecificationDictionary(
  tx: Prisma.TransactionClient, values: JewellerySpecificationsDto[],
) {
  try {
    return await specificationDictionary(tx, values);
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    throw new ServiceUnavailableException({
      code: 'SPECIFICATION_DICTIONARY_INVALID', message_key: 'errors.configuration_unavailable',
    });
  }
}

function decimalValue(value: string): string {
  const decimal = new Prisma.Decimal(value);
  if (!decimal.isPositive() || decimal.isZero()) invalidSpecifications();
  return decimal.toFixed();
}

function invalidSpecifications(field = 'specifications'): never {
  throw new BadRequestException({
    code: 'SPECIFICATIONS_INVALID', message_key: 'errors.validation', details: { field },
  });
}

export function specificationsJson(value: JewellerySpecificationsDto): Prisma.InputJsonObject {
  const pieceJson = (piece: PieceSpecificationsDto): Prisma.InputJsonObject => ({
    weight_g: piece.weight_g,
    materials: piece.materials.map(material => ({ ...material })),
    stone_groups: piece.stone_groups.map(stone => ({ ...stone })),
    pearl_type_codes: piece.pearl_type_codes,
    finish_codes: piece.finish_codes,
    construction_detail_codes: piece.construction_detail_codes,
    construction_details_bg: piece.construction_details_bg,
    construction_details_en: piece.construction_details_en,
  });
  return {
    ...pieceJson(value),
    components: value.components.map(component => ({
      ...pieceJson(component), key: component.key,
      name_bg: component.name_bg, name_en: component.name_en,
    })),
  };
}

export function specificationCodes(value: JewellerySpecificationsDto) {
  const entries: { group: SpecificationGroup; code: string; appliesTo?: string }[] = [];
  const add = (group: SpecificationGroup, code: string | null, appliesTo?: string) => {
    if (code !== null) entries.push({ group, code, appliesTo });
  };
  for (const piece of specificationPieces(value)) {
    for (const material of piece.materials) {
      add('material', material.material_code);
      const context = material.material_code ? `material.${material.material_code}` : undefined;
      add('material_colour', material.colour_code, context);
      add('fineness', material.fineness_code, context);
      add('gold_karat', material.gold_karat_code, context);
    }
    for (const stone of piece.stone_groups) {
      add('gemstone', stone.stone_code);
      const context = stone.stone_code ? `gemstone.${stone.stone_code}` : undefined;
      add('stone_colour', stone.colour_code, context);
      add('stone_grade', stone.grade_code, context);
      add('stone_clarity', stone.clarity_code, context);
      add('stone_shape', stone.shape_code, context);
    }
    for (const code of piece.pearl_type_codes) add('pearl_type', code);
    for (const code of piece.finish_codes) add('finish', code);
    for (const code of piece.construction_detail_codes) add('construction_detail', code);
  }
  return entries;
}

export async function specificationDictionary(
  tx: Prisma.TransactionClient, values: JewellerySpecificationsDto[],
) {
  const requested = values.flatMap(specificationCodes);
  if (!requested.length) return new Map<string, {
    code: string; labelBg: string; labelEn: string; appliesTo: string[];
  }>();
  const groupedCodes = new Map<SpecificationGroup, Set<string>>();
  for (const { group, code } of requested) {
    const codes = groupedCodes.get(group) ?? new Set<string>();
    codes.add(code);
    groupedCodes.set(group, codes);
  }
  const rows = await tx.dictionaryEntry.findMany({
    where: {
      active: true,
      OR: [...groupedCodes].map(([group, codes]) => ({ group, code: { in: [...codes] } })),
    },
    select: { group: true, code: true, labelBg: true, labelEn: true, appliesTo: true },
  });
  const dictionary = new Map(rows.map(row => [`${row.group}:${row.code}`, row]));
  for (const entry of requested) {
    const row = dictionary.get(`${entry.group}:${entry.code}`);
    if (!row || (row.appliesTo.length && entry.appliesTo && !row.appliesTo.includes(entry.appliesTo))) {
      throw new BadRequestException({
        code: 'SPECIFICATION_DICTIONARY_INVALID', message_key: 'errors.validation',
      });
    }
  }
  return dictionary;
}

export function projectSpecifications(
  value: JewellerySpecificationsDto | null,
  dictionary: Awaited<ReturnType<typeof specificationDictionary>>, locale: Locale,
) {
  if (value === null) return null;
  const label = (group: SpecificationGroup, code: string | null) => {
    if (code === null) return null;
    const entry = dictionary.get(`${group}:${code}`);
    if (!entry) throw new ServiceUnavailableException({
      code: 'SPECIFICATION_DICTIONARY_INVALID', message_key: 'errors.configuration_unavailable',
    });
    return { code, label: locale === 'bg' ? entry.labelBg : entry.labelEn };
  };
  const piece = (input: PieceSpecificationsDto) => ({
    weight_g: input.weight_g,
    materials: input.materials.map(entry => ({
      material: label('material', entry.material_code),
      colour: label('material_colour', entry.colour_code),
      fineness: label('fineness', entry.fineness_code),
      gold_karat: label('gold_karat', entry.gold_karat_code),
    })),
    stone_groups: input.stone_groups.map(entry => ({
      stone: label('gemstone', entry.stone_code), carat_weight: entry.carat_weight,
      colour: label('stone_colour', entry.colour_code),
      grade: label('stone_grade', entry.grade_code),
      clarity: label('stone_clarity', entry.clarity_code),
      shape: label('stone_shape', entry.shape_code),
    })),
    pearl_types: input.pearl_type_codes.map(code => label('pearl_type', code)),
    finishes: input.finish_codes.map(code => label('finish', code)),
    construction: input.construction_detail_codes.map(code => label('construction_detail', code)),
    construction_details: locale === 'bg' ? input.construction_details_bg : input.construction_details_en,
  });
  return {
    ...piece(value),
    components: value.components.map(component => ({
      key: component.key, name: locale === 'bg' ? component.name_bg : component.name_en,
      ...piece(component),
    })),
  };
}
