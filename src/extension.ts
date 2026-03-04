import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/* ══════════════════════════════════════════════════════════
   Activate
   ══════════════════════════════════════════════════════════ */
export function activate(context: vscode.ExtensionContext) {
    const openEditorCommand = vscode.commands.registerCommand('aether.openDiagramEditor', () => {
        openDiagramEditor(context);
    });

    const scanCommand = vscode.commands.registerCommand('aether.scanArchitecture', () => {
        if (currentPanel) {
            const diagram = scanWorkspaceDiagram();
            if (diagram) {
                currentPanel.webview.postMessage({
                    type: 'LOAD_AUTOGEN_DIAGRAM',
                    payload: diagram
                });
                vscode.window.showInformationMessage('Arquitectura escaneada y enviada al diagramador.');
            } else {
                vscode.window.showWarningMessage('No se encontró un workspace abierto para escanear.');
            }
        } else {
            openDiagramEditor(context);
        }
    });

    const aetherProvider = new AetherTreeDataProvider();
    vscode.window.registerTreeDataProvider('aether-diagram.menu', aetherProvider);

    context.subscriptions.push(openEditorCommand, scanCommand);
}

/* ══════════════════════════════════════════════════════════
   Webview Panel
   ══════════════════════════════════════════════════════════ */
let currentPanel: vscode.WebviewPanel | undefined = undefined;

function openDiagramEditor(context: vscode.ExtensionContext) {
    const columnToShowIn = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;

    if (currentPanel) {
        currentPanel.reveal(columnToShowIn);
        return;
    }

    currentPanel = vscode.window.createWebviewPanel(
        'aetherEditor',
        'Diagramador 3D',
        columnToShowIn || vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview-dist'))]
        }
    );

    const htmlPath = path.join(context.extensionPath, 'webview-dist', 'index.html');

    if (fs.existsSync(htmlPath)) {
        currentPanel.webview.html = fs.readFileSync(htmlPath, 'utf8');
    } else {
        currentPanel.webview.html = `<!DOCTYPE html>
        <html lang="en"><body>
            <h1>Error: No se encontró la aplicación compilada</h1>
            <p>Ejecuta <code>npm run build</code> en la carpeta <code>app/</code>.</p>
        </body></html>`;
    }

    currentPanel.webview.onDidReceiveMessage(
        message => {
            if (message.command === 'ready') {
                const diagram = scanWorkspaceDiagram();
                if (diagram && currentPanel) {
                    currentPanel.webview.postMessage({
                        type: 'LOAD_AUTOGEN_DIAGRAM',
                        payload: diagram
                    });
                }
            } else if (message.command === 'exportJSON') {
                handleExportJSON(message.data, message.fileName);
            } else if (message.command === 'exportPNG') {
                handleExportPNG(message.data, message.fileName);
            }
        },
        undefined,
        context.subscriptions
    );

    currentPanel.onDidDispose(() => {
        currentPanel = undefined;
    }, null, context.subscriptions);
}

/* ══════════════════════════════════════════════════════════
   EXPORT HANDLERS — Save files from the webview
   ══════════════════════════════════════════════════════════ */

async function handleExportJSON(jsonData: string, fileName: string) {
    const uri = await vscode.window.showSaveDialog({
        filters: { 'JSON Files': ['json'] },
        defaultUri: vscode.Uri.file(fileName),
    });
    if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(jsonData, 'utf8'));
        vscode.window.showInformationMessage(`Diagrama exportado: ${uri.fsPath}`);
    }
}

async function handleExportPNG(base64Data: string, fileName: string) {
    const uri = await vscode.window.showSaveDialog({
        filters: { 'PNG Images': ['png'] },
        defaultUri: vscode.Uri.file(fileName),
    });
    if (uri) {
        const buffer = Buffer.from(base64Data, 'base64');
        await vscode.workspace.fs.writeFile(uri, buffer);
        vscode.window.showInformationMessage(`Imagen exportada: ${uri.fsPath}`);
    }
}

/* ══════════════════════════════════════════════════════════
   ARCHITECTURE SCANNER — Deep Analysis
   ══════════════════════════════════════════════════════════ */

const generateId = () => Math.random().toString(36).substring(2, 15);

// Máximo de archivos mostrados por carpeta (el resto se agrupa en "...y N más")
const MAX_FILES_PER_DIR = 8;

// Directorios y archivos que siempre se ignoran
const IGNORED = new Set([
    'node_modules', '.git', '.vscode', 'dist', 'out', 'build', '__pycache__',
    '.idea', '.gradle', 'target', 'bin', 'obj', '.next', '.nuxt', 'coverage',
    '.cache', '.parcel-cache', 'vendor', '.svn', '.hg', 'venv', 'env',
    '.env', '.DS_Store', 'thumbs.db', 'logs', 'tmp', 'temp',
    '.sass-cache', '.nyc_output', '.pytest_cache', '.mypy_cache',
    'bower_components', 'jspm_packages', '.serverless', '.terraform',
    'Pods', 'DerivedData', 'xcuserdata', '.expo', '.meteor',
    'webview-dist', '.angular', '.svelte-kit',
]);

// Archivos individuales que se ignoran (configs, lints, locks, etc.)
const IGNORED_FILES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
    'tsconfig.json', 'tsconfig.node.json', 'tsconfig.app.json',
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
    '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs',
    '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierignore',
    'prettier.config.js', 'prettier.config.mjs',
    '.editorconfig', '.gitignore', '.gitattributes', '.npmrc', '.nvmrc',
    'postcss.config.js', 'postcss.config.mjs', 'postcss.config.cjs',
    'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs',
    'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
    'webpack.config.js', 'webpack.config.ts',
    'rollup.config.js', 'rollup.config.mjs',
    'babel.config.js', 'babel.config.json', '.babelrc',
    'jest.config.js', 'jest.config.ts', 'vitest.config.ts',
    'karma.conf.js', '.mocharc.yml',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    'Makefile', 'Procfile', 'Rakefile', 'Gemfile', 'Pipfile',
    '.dockerignore', '.eslintignore', '.stylelintrc',
    'LICENSE', 'LICENSE.md', 'LICENSE.txt',
    'CHANGELOG.md', 'CONTRIBUTING.md',
    'renovate.json', '.releaserc', '.commitlintrc.js',
]);

// ── Clasificación de capas arquitectónicas ──
type ArchLayer = 'entry' | 'business' | 'domain' | 'persistence' | 'presentation' | 'infra' | 'util' | 'config' | 'test' | 'general';

interface LayerConfig {
    type: string;      // NodeKind del diagrama
    color: string;
    groupLabel: string;
    yHeight: number;   // Altura vertical (Y) para separar capas en 3D
}

const LAYER_MAP: Record<ArchLayer, LayerConfig> = {
    entry: { type: 'adapter', color: '#14532d', groupLabel: '🔌 Entrada / API', yHeight: 5 },
    presentation: { type: 'external', color: '#4c1d95', groupLabel: '🖥️ Presentación / UI', yHeight: 5 },
    business: { type: 'service', color: '#166534', groupLabel: '⚙️ Lógica de Negocio', yHeight: 3.5 },
    config: { type: 'service', color: '#78350f', groupLabel: '⚙️ Configuración', yHeight: 3.5 },
    domain: { type: 'core', color: '#1f2937', groupLabel: '🧩 Dominio / Modelos', yHeight: 2 },
    util: { type: 'module', color: '#1e3a5f', groupLabel: '🔧 Utilidades', yHeight: 2 },
    persistence: { type: 'db', color: '#1e1b4b', groupLabel: '🗄️ Persistencia', yHeight: 0.5 },
    infra: { type: 'host', color: '#374151', groupLabel: '🏗️ Infraestructura', yHeight: 0.5 },
    test: { type: 'module', color: '#111827', groupLabel: '🧪 Tests', yHeight: 1 },
    general: { type: 'module', color: '#1e3a5f', groupLabel: '📁 General', yHeight: 1 },
};

const LAYER_KEYWORDS: Record<ArchLayer, string[]> = {
    entry: ['controller', 'controllers', 'routes', 'route', 'api', 'endpoints', 'handlers', 'handler', 'rest', 'graphql', 'grpc', 'gateway'],
    business: ['service', 'services', 'usecase', 'usecases', 'use-cases', 'application', 'business', 'logic', 'interactor', 'interactors'],
    domain: ['model', 'models', 'entity', 'entities', 'domain', 'core', 'schema', 'schemas', 'types', 'interfaces', 'dto', 'dtos', 'vo'],
    persistence: ['repository', 'repositories', 'dal', 'dao', 'db', 'database', 'migration', 'migrations', 'seed', 'seeds', 'prisma', 'sequelize', 'typeorm'],
    presentation: ['ui', 'view', 'views', 'components', 'component', 'pages', 'page', 'screens', 'screen', 'render', 'templates', 'layout', 'layouts', 'widgets'],
    infra: ['infra', 'infrastructure', 'docker', 'deploy', 'devops', 'ci', 'cd', 'terraform', 'kubernetes', 'k8s', 'cloud', 'aws', 'azure', 'gcp'],
    util: ['util', 'utils', 'helpers', 'helper', 'lib', 'libs', 'shared', 'common', 'tools', 'support'],
    config: ['config', 'configs', 'configuration', 'settings', 'env', 'middleware', 'middlewares', 'interceptor', 'interceptors', 'guard', 'guards', 'filter', 'filters', 'pipe', 'pipes'],
    test: ['test', 'tests', '__tests__', 'spec', 'specs', '__spec__', 'e2e', 'integration', 'unit', 'fixtures', 'mocks', '__mocks__'],
    general: [],
};

function classifyLayer(name: string): ArchLayer {
    const lower = name.toLowerCase();
    for (const [layer, keywords] of Object.entries(LAYER_KEYWORDS) as [ArchLayer, string[]][]) {
        if (keywords.includes(lower)) return layer;
    }
    return 'general';
}

// ── Extensiones de código fuente que analizamos ──
const SOURCE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.java', '.kt', '.cs', '.go', '.rs', '.rb', '.php',
    '.vue', '.svelte',
]);

// ── Tipos de proyecto ──
type ProjectType = 'node' | 'python' | 'java' | 'dotnet' | 'go' | 'unknown';

function detectProjectType(rootPath: string): ProjectType {
    if (fs.existsSync(path.join(rootPath, 'package.json'))) return 'node';
    if (fs.existsSync(path.join(rootPath, 'requirements.txt')) || fs.existsSync(path.join(rootPath, 'setup.py')) || fs.existsSync(path.join(rootPath, 'pyproject.toml'))) return 'python';
    if (fs.existsSync(path.join(rootPath, 'pom.xml')) || fs.existsSync(path.join(rootPath, 'build.gradle'))) return 'java';
    if (fs.existsSync(path.join(rootPath, '*.csproj')) || fs.existsSync(path.join(rootPath, '*.sln'))) return 'dotnet';
    if (fs.existsSync(path.join(rootPath, 'go.mod'))) return 'go';
    return 'unknown';
}

// ── Interfaz interna para archivos escaneados ──
interface ScannedModule {
    id: string;
    relativePath: string;
    name: string;
    isDir: boolean;
    layer: ArchLayer;
    children: string[];   // IDs de hijos directos (si es directorio)
    imports: string[];    // rutas relativas que importa (si es archivo fuente)
    depth: number;
}

/** Escanea recursivamente el directorio hasta `maxDepth` niveles */
function scanDirectory(rootPath: string, currentPath: string, maxDepth: number, depth: number, modules: Map<string, ScannedModule>): string | null {
    if (depth > maxDepth) return null;

    const dirName = path.basename(currentPath);
    if (IGNORED.has(dirName) || dirName.startsWith('.')) return null;

    const relativePath = path.relative(rootPath, currentPath);
    const id = generateId();
    const layer = classifyLayer(dirName);

    const module: ScannedModule = {
        id,
        relativePath: relativePath || dirName,
        name: dirName,
        isDir: true,
        layer,
        children: [],
        imports: [],
        depth,
    };

    try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        let fileCount = 0;
        let skippedFiles = 0;

        for (const entry of entries) {
            if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;

            const fullPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
                const childId = scanDirectory(rootPath, fullPath, maxDepth, depth + 1, modules);
                if (childId) module.children.push(childId);
            } else if (entry.isFile()) {
                if (IGNORED_FILES.has(entry.name)) continue;
                const ext = path.extname(entry.name);
                if (SOURCE_EXTENSIONS.has(ext)) {
                    fileCount++;
                    if (fileCount <= MAX_FILES_PER_DIR) {
                        const fileId = generateId();
                        const fileRelPath = path.relative(rootPath, fullPath);
                        const fileImports = extractImports(fullPath, ext);

                        modules.set(fileId, {
                            id: fileId,
                            relativePath: fileRelPath,
                            name: entry.name,
                            isDir: false,
                            layer: layer !== 'general' ? layer : classifyFileByName(entry.name),
                            children: [],
                            imports: fileImports,
                            depth: depth + 1,
                        });
                        module.children.push(fileId);
                    } else {
                        skippedFiles++;
                    }
                }
            }
        }

        // Si se omitieron archivos, agregar un nodo resumen
        if (skippedFiles > 0) {
            const summaryId = generateId();
            modules.set(summaryId, {
                id: summaryId,
                relativePath: `${relativePath || dirName}/...`,
                name: `...y ${skippedFiles} más`,
                isDir: false,
                layer,
                children: [],
                imports: [],
                depth: depth + 1,
            });
            module.children.push(summaryId);
        }
    } catch (e) {
        // Silently skip unreadable dirs
    }

    // Solo agregar directorios que tengan hijos relevantes
    if (module.children.length > 0) {
        modules.set(id, module);
        return id;
    }
    return null;
}

/** Clasifica un archivo individual por su nombre */
function classifyFileByName(filename: string): ArchLayer {
    const lower = filename.toLowerCase();
    if (lower.includes('controller') || lower.includes('route') || lower.includes('handler')) return 'entry';
    if (lower.includes('service') || lower.includes('usecase')) return 'business';
    if (lower.includes('model') || lower.includes('entity') || lower.includes('schema') || lower.includes('type') || lower.includes('dto')) return 'domain';
    if (lower.includes('repo') || lower.includes('dao') || lower.includes('migration')) return 'persistence';
    if (lower.includes('component') || lower.includes('view') || lower.includes('page') || lower.includes('screen')) return 'presentation';
    if (lower.includes('config') || lower.includes('middleware')) return 'config';
    if (lower.includes('.test.') || lower.includes('.spec.') || lower.includes('__test')) return 'test';
    if (lower.includes('util') || lower.includes('helper')) return 'util';
    return 'general';
}

/** Extrae las rutas de import/require de un archivo fuente */
function extractImports(filePath: string, ext: string): string[] {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const imports: string[] = [];

        if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(ext)) {
            // ES imports: import ... from '...'
            // Require: require('...')
            const importRegex = /(?:import\s+.*?from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/g;
            let match;
            while ((match = importRegex.exec(content)) !== null) {
                const importPath = match[1] || match[2];
                // Solo imports relativos (los que empiezan con . o ..)
                if (importPath.startsWith('.')) {
                    imports.push(importPath);
                }
            }
        } else if (ext === '.py') {
            // Python: from X import Y  |  import X
            const pyImportRegex = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
            let match;
            while ((match = pyImportRegex.exec(content)) !== null) {
                const mod = match[1] || match[2];
                if (mod && !mod.startsWith('__') && mod.includes('.')) {
                    imports.push(mod);
                }
            }
        } else if (ext === '.java' || ext === '.kt') {
            // Java/Kotlin: import com.example.something
            const javaImportRegex = /import\s+([\w.]+)/g;
            let match;
            while ((match = javaImportRegex.exec(content)) !== null) {
                imports.push(match[1]);
            }
        }

        return imports;
    } catch {
        return [];
    }
}

/** Lee las dependencias de package.json */
function readExternalDependencies(rootPath: string): { name: string; isDev: boolean }[] {
    const pkgPath = path.join(rootPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return [];

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps: { name: string; isDev: boolean }[] = [];

        if (pkg.dependencies) {
            for (const name of Object.keys(pkg.dependencies)) {
                deps.push({ name, isDev: false });
            }
        }
        if (pkg.devDependencies) {
            for (const name of Object.keys(pkg.devDependencies)) {
                deps.push({ name, isDev: true });
            }
        }
        return deps;
    } catch {
        return [];
    }
}

/** Resuelve un import relativo a un archivo real dentro del módulo map */
function resolveImportToModule(importPath: string, importerRelPath: string, modules: Map<string, ScannedModule>): string | null {
    const importerDir = path.dirname(importerRelPath);
    let resolved = path.join(importerDir, importPath).replace(/\\/g, '/');

    // Intentar con varias extensiones
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
    for (const ext of extensions) {
        const candidate = resolved + ext;
        for (const [id, mod] of modules) {
            const modPath = mod.relativePath.replace(/\\/g, '/');
            if (modPath === candidate) return id;
        }
    }
    return null;
}

/* ══════════════════════════════════════════════════════════
   MAIN SCANNER — Generates the full diagram
   ══════════════════════════════════════════════════════════ */
function scanWorkspaceDiagram() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;

    const rootPath = folders[0].uri.fsPath;
    const rootName = path.basename(rootPath);
    const projectType = detectProjectType(rootPath);

    const modules = new Map<string, ScannedModule>();

    // ── 1. Detectar directorios fuente y escanear su contenido ──
    // Estos son los directorios que contienen la arquitectura real del proyecto
    const SOURCE_ROOTS = new Set([
        'src', 'app', 'server', 'client', 'backend', 'frontend',
        'lib', 'packages', 'apps', 'modules', 'core', 'api',
        'services', 'components', 'pages', 'views', 'controllers',
        'models', 'routes', 'middleware', 'handlers', 'domain',
        'infrastructure', 'application', 'presentation',
    ]);

    const rootChildren: string[] = [];
    try {
        const topEntries = fs.readdirSync(rootPath, { withFileTypes: true });

        // Primero buscar directorios fuente
        const sourceRoots: string[] = [];
        const otherDirs: string[] = [];

        for (const entry of topEntries) {
            if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;

            if (entry.isDirectory()) {
                if (SOURCE_ROOTS.has(entry.name.toLowerCase())) {
                    sourceRoots.push(entry.name);
                } else {
                    otherDirs.push(entry.name);
                }
            }
        }

        // Si encontramos directorios fuente, escanear DENTRO de ellos con mayor profundidad
        if (sourceRoots.length > 0) {
            for (const srcDir of sourceRoots) {
                const srcPath = path.join(rootPath, srcDir);
                // Escanear el contenido de cada directorio fuente directamente
                const srcEntries = fs.readdirSync(srcPath, { withFileTypes: true });

                for (const entry of srcEntries) {
                    if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
                    if (IGNORED_FILES.has(entry.name)) continue;

                    const fullPath = path.join(srcPath, entry.name);

                    if (entry.isDirectory()) {
                        const childId = scanDirectory(rootPath, fullPath, 5, 1, modules);
                        if (childId) rootChildren.push(childId);
                    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
                        const fileId = generateId();
                        modules.set(fileId, {
                            id: fileId,
                            relativePath: path.relative(rootPath, fullPath),
                            name: `${srcDir}/${entry.name}`,
                            isDir: false,
                            layer: classifyFileByName(entry.name),
                            children: [],
                            imports: extractImports(fullPath, path.extname(entry.name)),
                            depth: 1,
                        });
                        rootChildren.push(fileId);
                    }
                }
            }

            // También incluir carpetas no-fuente que sean arquitectónicamente relevantes
            for (const dirName of otherDirs) {
                const lowerName = dirName.toLowerCase();
                // Solo incluir carpetas que parezcan relevantes (no configs, tests, etc.)
                const isRelevant = ['prisma', 'graphql', 'proto', 'schemas', 'migrations',
                    'seeds', 'fixtures', 'public', 'assets', 'static',
                    'templates', 'i18n', 'locales', 'config'].includes(lowerName);
                if (isRelevant) {
                    const childId = scanDirectory(rootPath, path.join(rootPath, dirName), 3, 1, modules);
                    if (childId) rootChildren.push(childId);
                }
            }
        } else {
            // Fallback: si no hay directorios fuente conocidos, escanear todo el root
            for (const entry of topEntries) {
                if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;

                if (entry.isDirectory()) {
                    const childId = scanDirectory(rootPath, path.join(rootPath, entry.name), 4, 1, modules);
                    if (childId) rootChildren.push(childId);
                } else if (entry.isFile() && !IGNORED_FILES.has(entry.name) && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
                    const fileId = generateId();
                    const fullPath = path.join(rootPath, entry.name);
                    modules.set(fileId, {
                        id: fileId,
                        relativePath: entry.name,
                        name: entry.name,
                        isDir: false,
                        layer: classifyFileByName(entry.name),
                        children: [],
                        imports: extractImports(fullPath, path.extname(entry.name)),
                        depth: 1,
                    });
                    rootChildren.push(fileId);
                }
            }
        }
    } catch (e) {
        console.error('Error escaneando directorio raíz:', e);
    }

    // ── 2. Construir nodos del diagrama ──
    const nodes: any[] = [];
    const edges: any[] = [];
    const groups: any[] = [];

    // Nodo central del proyecto
    const rootId = generateId();
    nodes.push({
        id: rootId,
        type: 'core',
        category: 'architecture',
        position: { x: 0, y: 7, z: 0 },
        size: { x: 4.2, y: 0.85, z: 2.2 },
        label: `📦 ${rootName} (${projectType})`,
        style: { variant: 'default', colorToken: '#1f2937' }
    });

    // Agrupar módulos por capa
    const layerGroups = new Map<ArchLayer, string[]>();

    // Solo crear nodos para directorios de profundidad 1 (capas principales)
    // y archivos sueltos en la raíz
    for (const childId of rootChildren) {
        const mod = modules.get(childId);
        if (!mod) continue;

        const layerCfg = LAYER_MAP[mod.layer];
        const nodeId = mod.id;

        // Nodo para esta carpeta/archivo — usar tipos 3D, nunca 'chip' (flat)
        const nodeType = mod.isDir ? layerCfg.type : 'module';
        const nodeSize = mod.isDir
            ? { x: 2.8, y: 0.85, z: 1.8 }
            : { x: 2.1, y: 0.7, z: 1.5 };

        const childCount = mod.isDir ? mod.children.length : 0;
        const nodeLabel = mod.isDir
            ? `${mod.name} (${childCount})`
            : mod.name;

        nodes.push({
            id: nodeId,
            type: nodeType,
            category: 'architecture',
            position: { x: 0, y: layerCfg.yHeight, z: 0 },
            size: nodeSize,
            label: nodeLabel,
            style: { variant: 'default', colorToken: layerCfg.color }
        });

        // Edge del root a este nodo
        edges.push({
            id: generateId(),
            from: { nodeId: rootId },
            to: { nodeId: nodeId },
            style: { dashed: false, arrow: true, curve: 'straight' }
        });

        // Agrupar por layer
        if (!layerGroups.has(mod.layer)) layerGroups.set(mod.layer, []);
        layerGroups.get(mod.layer)!.push(nodeId);

        // Si es directorio, crear nodos para sus hijos internos
        if (mod.isDir) {
            for (const subChildId of mod.children) {
                const subMod = modules.get(subChildId);
                if (!subMod) continue;

                const subLayerCfg = LAYER_MAP[subMod.layer];
                const subNodeType = subMod.isDir ? subLayerCfg.type : 'service';
                const subSize = subMod.isDir
                    ? { x: 2.4, y: 0.7, z: 1.6 }
                    : { x: 2.1, y: 0.7, z: 1.5 };

                nodes.push({
                    id: subMod.id,
                    type: subNodeType,
                    category: 'architecture',
                    position: { x: 0, y: subLayerCfg.yHeight, z: 0 },
                    size: subSize,
                    label: subMod.name,
                    style: { variant: 'default', colorToken: subLayerCfg.color }
                });

                // Edge del padre al hijo
                edges.push({
                    id: generateId(),
                    from: { nodeId: nodeId },
                    to: { nodeId: subMod.id },
                    style: { dashed: true, arrow: true, curve: 'bezier' }
                });

                // Agregar al grupo de la capa
                if (!layerGroups.has(subMod.layer)) layerGroups.set(subMod.layer, []);
                layerGroups.get(subMod.layer)!.push(subMod.id);
            }
        }
    }

    // ── 3. Crear edges basados en imports reales ──
    for (const [, mod] of modules) {
        if (mod.imports.length === 0) continue;

        for (const imp of mod.imports) {
            const targetId = resolveImportToModule(imp, mod.relativePath, modules);
            if (targetId && targetId !== mod.id) {
                // Verificar que ambos nodos existen en el diagrama
                const sourceExists = nodes.some((n: any) => n.id === mod.id);
                const targetExists = nodes.some((n: any) => n.id === targetId);
                if (sourceExists && targetExists) {
                    // Evitar duplicados
                    const alreadyExists = edges.some((e: any) =>
                        e.from.nodeId === mod.id && e.to.nodeId === targetId
                    );
                    if (!alreadyExists) {
                        edges.push({
                            id: generateId(),
                            from: { nodeId: mod.id },
                            to: { nodeId: targetId },
                            style: { dashed: true, arrow: true, curve: 'bezier' }
                        });
                    }
                }
            }
        }
    }

    // ── 4. Crear groups por capa arquitectónica ──
    for (const [layer, nodeIds] of layerGroups) {
        if (nodeIds.length === 0) continue;
        const cfg = LAYER_MAP[layer];
        groups.push({
            id: generateId(),
            label: cfg.groupLabel,
            nodeIds: nodeIds,
            color: cfg.color,
        });
    }

    // ── 5. Agregar dependencias externas (solo para Node.js) ──
    if (projectType === 'node') {
        const externalDeps = readExternalDependencies(rootPath);
        const mainDeps = externalDeps.filter(d => !d.isDev).slice(0, 15); // máx 15 dependencias principales
        const extGroupNodeIds: string[] = [];

        for (const dep of mainDeps) {
            const depId = generateId();
            nodes.push({
                id: depId,
                type: 'external',
                category: 'architecture',
                position: { x: 0, y: -1, z: 0 },
                size: { x: 2.1, y: 0.6, z: 1.2 },
                label: `📦 ${dep.name}`,
                style: { variant: 'default', colorToken: '#4c1d95' }
            });

            edges.push({
                id: generateId(),
                from: { nodeId: rootId },
                to: { nodeId: depId },
                style: { dashed: true, arrow: true, curve: 'straight' }
            });

            extGroupNodeIds.push(depId);
        }

        if (extGroupNodeIds.length > 0) {
            groups.push({
                id: generateId(),
                label: '📦 Dependencias Externas',
                nodeIds: extGroupNodeIds,
                color: '#4c1d95',
            });
        }
    }

    return { nodes, edges, groups };
}

/* ══════════════════════════════════════════════════════════
   Tree Data Provider — Activity Bar
   ══════════════════════════════════════════════════════════ */
class AetherTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) return Promise.resolve([]);

        // Botón: Abrir Diagramador
        const openItem = new vscode.TreeItem("Abrir Diagramador 3D", vscode.TreeItemCollapsibleState.None);
        openItem.command = { command: 'aether.openDiagramEditor', title: 'Abrir Editor' };
        openItem.iconPath = new vscode.ThemeIcon('edit');
        openItem.tooltip = "Abre el editor isométrico de arquitectura de software";

        // Botón: Escanear Arquitectura
        const scanItem = new vscode.TreeItem("Escanear Arquitectura", vscode.TreeItemCollapsibleState.None);
        scanItem.command = { command: 'aether.scanArchitecture', title: 'Escanear' };
        scanItem.iconPath = new vscode.ThemeIcon('search');
        scanItem.tooltip = "Analiza el proyecto abierto y genera un diagrama automáticamente";

        return Promise.resolve([openItem, scanItem]);
    }
}

export function deactivate() { }
