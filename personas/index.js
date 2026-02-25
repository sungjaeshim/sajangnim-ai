import { dojun } from './dojun.js';
import { jia } from './jia.js';
import { eric } from './eric.js';
import { hana } from './hana.js';
import { minjun } from './minjun.js';

const personas = { dojun, jia, eric, hana, minjun };

export function getPersona(id) {
  return personas[id] || null;
}

export function getAllPersonas() {
  return Object.entries(personas).map(([id, p]) => ({
    id,
    name: p.name,
    role: p.role,
    icon: p.icon,
    description: p.description,
    color: p.color,
    greeting: p.greeting,
  }));
}
