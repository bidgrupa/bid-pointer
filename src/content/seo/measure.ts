/** Text width in Google's fonts, measured on a canvas: titles in 20px Arial, descriptions in 14px. */
import { roughMeasure, type Measure } from '../../shared/seo';

let ctx: CanvasRenderingContext2D | null | undefined;

export const googleMeasure: Measure = (text, kind) => {
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return roughMeasure(text, kind);
  ctx.font = kind === 'title' ? '20px Arial, sans-serif' : '14px Arial, sans-serif';
  return ctx.measureText(text).width;
};
