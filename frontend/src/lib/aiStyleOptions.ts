import {
  EmojiStyle,
  ResponseLength,
  ResponseTone,
  TrainingFlexibility,
} from '../types';

export const RESPONSE_TONE_OPTIONS: Array<{
  value: ResponseTone;
  label: string;
  shortDesc: string;
}> = [
  {
    value: 'CONSULTATIVE',
    label: 'Consultivo & Profissional',
    shortDesc: 'Equilibrado, prestativo e confiável.',
  },
  {
    value: 'CASUAL',
    label: 'Descontraído & Amigável',
    shortDesc: 'Leve, próximo e natural de WhatsApp.',
  },
  {
    value: 'FORMAL',
    label: 'Formal & Corporativo',
    shortDesc: 'Polido, respeitoso e sem gírias.',
  },
  {
    value: 'DIRECT',
    label: 'Direto & Objetivo',
    shortDesc: 'Sem rodeios, claro e rápido de ler.',
  },
  {
    value: 'EMPATHETIC',
    label: 'Empático & Acolhedor',
    shortDesc: 'Calmo, paciente e focado em ajudar.',
  },
  {
    value: 'PERSUASIVE',
    label: 'Comercial & Persuasivo',
    shortDesc: 'Focado em valor e próximo passo.',
  },
];

export const TRAINING_FLEXIBILITY_OPTIONS: Array<{
  value: TrainingFlexibility;
  label: string;
  badge: string;
  shortDesc: string;
}> = [
  {
    value: 'STRICT',
    label: 'Fiel aos exemplos',
    badge: 'Mais literal',
    shortDesc:
      'Segue bem de perto a estrutura e a redação cadastradas no Treinamento IA.',
  },
  {
    value: 'BALANCED',
    label: 'Equilibrado',
    badge: 'Padrão',
    shortDesc:
      'Mantém a linha e a precisão dos exemplos, adaptando a redação ao contexto do cliente.',
  },
  {
    value: 'FLEXIBLE',
    label: 'Flexível e natural',
    badge: 'Recomendado p/ fluidez',
    shortDesc:
      'Usa os exemplos só como base de fatos e assertividade — reescreve livremente sem copiar ao pé da letra.',
  },
];

export const RESPONSE_LENGTH_OPTIONS: Array<{
  value: ResponseLength;
  label: string;
  shortDesc: string;
}> = [
  { value: 'SHORT', label: 'Curto', shortDesc: '1 a 2 frases diretas' },
  { value: 'MEDIUM', label: 'Médio', shortDesc: '2 a 4 frases (ideal p/ WhatsApp)' },
  { value: 'DETAILED', label: 'Detalhado', shortDesc: 'Mais contexto e explicação' },
];

export const EMOJI_STYLE_OPTIONS: Array<{
  value: EmojiStyle;
  label: string;
  shortDesc: string;
}> = [
  { value: 'NONE', label: 'Sem emojis', shortDesc: 'Texto limpo, zero emojis' },
  { value: 'LIGHT', label: 'Pontual', shortDesc: '1–2 emojis discretos' },
  { value: 'EXPRESSIVE', label: 'Expressivo', shortDesc: 'Mais caloroso e visual' },
];

export function getToneLabel(value?: string | null): string {
  return (
    RESPONSE_TONE_OPTIONS.find((o) => o.value === value)?.label ||
    'Herdar Geral'
  );
}

export function getFlexibilityLabel(value?: string | null): string {
  return (
    TRAINING_FLEXIBILITY_OPTIONS.find((o) => o.value === value)?.label ||
    'Herdar Geral'
  );
}
