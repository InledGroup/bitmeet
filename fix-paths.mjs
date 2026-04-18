import fs from 'fs';
import path from 'path';

const distDir = path.resolve('./dist');

function fixHtmlPaths(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      fixHtmlPaths(fullPath);
    } else if (fullPath.endsWith('.html')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Calcular la profundidad relativa desde el archivo actual hasta la carpeta dist/
      const relativePathToDist = path.relative(path.dirname(fullPath), distDir);
      // Si estamos en la raíz (dist/), el prefijo es '.', si no, es el relativePath (ej. '..')
      const prefix = relativePathToDist === '' ? '.' : relativePathToDist;

      // Reemplazamos /_astro/ por la ruta relativa correcta, ej: ../../_astro/
      const regexHref = /href="\/_astro\//g;
      const regexSrc = /src="\/_astro\//g;
      
      content = content.replace(regexHref, `href="${prefix}/_astro/`);
      content = content.replace(regexSrc, `src="${prefix}/_astro/`);
      
      fs.writeFileSync(fullPath, content);
      console.log(`[fix-paths] Corregidas las rutas en: ${path.relative(distDir, fullPath)} (Prefijo: ${prefix})`);
    }
  }
}

console.log('[fix-paths] Ajustando rutas relativas inteligentes para Electron...');
fixHtmlPaths(distDir);
console.log('[fix-paths] ¡Completado!');
