import { hex } from '../color'
import { TAILWIND_HUES } from '../palettes/tailwind'
import type { ThemeDef } from '../roles'

/**
 * Metriq: the look the app had before themes, value for value (calm Linear-style greys, one indigo for actions,
 * teal as the second colour). It is the default, so nobody sees a change until they pick another theme.
 * In dark mode the status colours and the teal stay as they are in light (as before).
 */
const series = ['#5E6AD2', '#14A39A', '#E0930F', '#D9558C', '#3B9FE0', '#8B6FD6'].map(hex)

export const metriq: ThemeDef = {
  id: 'metriq',
  label: 'Metriq',
  description: 'Calm greys with one indigo for actions. The original look.',
  light: {
    base: {
      'background-body': [250, 250, 251],
      'background-card': [255, 255, 255],
      'background-sidebar': [245, 245, 247],
      'text-primary': [27, 28, 31],
      'text-secondary': [107, 110, 120],
      'text-faint': [154, 156, 165],
      border: [231, 231, 235],
      'border-emphasized': [214, 215, 220],
      accent: [94, 106, 210],
      'accent-strong': [79, 90, 194],
      'accent-subtle': [242, 243, 252],
      'accent-muted': [228, 230, 248],
      highlight: [16, 160, 148],
      success: [34, 160, 94],
      warning: [222, 133, 10],
      error: [220, 64, 64],
      info: [2, 132, 199],
      shadow: [16, 18, 26],
    },
    neutral: {
      50: [247, 247, 248],
      100: [240, 240, 242],
      200: [228, 228, 232],
      300: [210, 211, 216],
      400: [163, 165, 173],
      500: [110, 112, 121],
      600: [82, 84, 92],
      700: [61, 63, 70],
      800: [39, 40, 45],
      900: [27, 28, 31],
      950: [17, 17, 19],
    },
    chart: series,
    hues: TAILWIND_HUES,
    // Buttons on the indigo, the red and the green have always had white text: the readability pass darkens those
    // colours a little where white would not read, rather than switching the text to black.
    derived: { 'on-accent': [255, 255, 255], 'on-error': [255, 255, 255], 'on-success': [255, 255, 255] },
  },
  dark: {
    base: {
      'background-body': [14, 15, 17],
      'background-card': [22, 23, 26],
      'background-sidebar': [18, 19, 21],
      'text-primary': [236, 237, 240],
      'text-secondary': [150, 153, 162],
      'text-faint': [104, 107, 116],
      border: [40, 42, 47],
      'border-emphasized': [56, 58, 64],
      accent: [120, 131, 236],
      'accent-strong': [104, 116, 226],
      'accent-subtle': [30, 32, 54],
      'accent-muted': [38, 41, 72],
      highlight: [16, 160, 148],
      success: [34, 160, 94],
      warning: [222, 133, 10],
      error: [220, 64, 64],
      info: [56, 189, 248],
      shadow: [0, 0, 0],
    },
    neutral: {
      50: [27, 28, 31],
      100: [33, 34, 38],
      200: [44, 46, 51],
      300: [60, 62, 69],
      400: [92, 95, 104],
      500: [140, 143, 152],
      600: [170, 173, 180],
      700: [201, 203, 208],
      800: [226, 227, 230],
      900: [240, 241, 243],
      950: [248, 248, 249],
    },
    chart: series,
    hues: TAILWIND_HUES,
    derived: { 'on-accent': [255, 255, 255], 'on-error': [255, 255, 255], 'on-success': [255, 255, 255] },
  },
}
