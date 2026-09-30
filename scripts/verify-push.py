#!/usr/bin/env python3
"""Coverage preflight using Sonar's baseline; the server remains authoritative."""
import argparse
import fnmatch
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/coverage-checkpoint.json'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode()


def snapshot():
    digest = hashlib.sha256()
    files = set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0'))
    for name in sorted(files):
        path = ROOT / name
        if name and path.is_file() and path.suffix != '.md':
            digest.update(name.encode() + b'\0' + path.read_bytes())
    return digest.hexdigest()


def properties():
    return dict(line.split('=', 1) for line in (ROOT / 'sonar-project.properties').read_text().splitlines()
                if line and not line.startswith('#'))


def api(endpoint, **params):
    url = 'https://sonarcloud.io/api/' + endpoint + '?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def sonar_baseline(props, branch):
    status = api('qualitygates/project_status', projectKey=props['sonar.projectKey'], branch=branch)['projectStatus']
    date = status.get('periods', [{}])[0].get('date')
    if not date:
        raise ValueError('Sonar baseline unavailable; use --base <commit> explicitly.')
    threshold = next(float(c['errorThreshold']) for c in status['conditions'] if c['metricKey'] == 'new_coverage')
    # Use the actual analysis revision, not the latest tag or origin/main.
    for page in range(1, 101):
        analyses = api('project_analyses/search', project=props['sonar.projectKey'], branch=branch, p=page, ps=100)['analyses']
        for analysis in analyses:
            if analysis['date'] == date and analysis.get('revision'):
                return analysis['revision'], threshold
        if not analyses or analyses[-1]['date'] < date:
            break
    raise ValueError(f'No analysis revision for Sonar baseline {date}; use --base <commit>.')


def source_path(name):
    path = Path(name)
    if path.is_absolute():
        path = path.relative_to(ROOT)
    return path.as_posix()


def read_lcov(path):
    files = {}
    lines = None
    for record in path.read_text().splitlines():
        if record.startswith('SF:'):
            lines = files.setdefault(source_path(record[3:]), {})
        elif lines is not None and record.startswith('DA:'):
            number, hits, *_ = record[3:].split(',')
            entry = lines.setdefault(int(number), [0, 0, 0])
            entry[0] = max(entry[0], int(hits) > 0)
        elif lines is not None and record.startswith('BRDA:'):
            number, _, _, hits = record[5:].split(',')
            entry = lines.setdefault(int(number), [0, 0, 0])
            entry[1] += int(hits != '-' and int(hits) > 0)
            entry[2] += 1
    if not files or not any(files.values()):
        raise ValueError(f'Empty coverage report: {path}')
    return files


def read_jacoco(path):
    files = {}
    for package in ET.parse(path).getroot().findall('package'):
        for source in package.findall('sourcefile'):
            suffix = Path(package.get('name', '')) / source.attrib['name']
            candidates = [ROOT / 'services/jvm-sidecar/src/main' / lang / suffix for lang in ('kotlin', 'java')]
            matches = [p for p in candidates if p.is_file()]
            if len(matches) != 1:
                raise ValueError(f'Cannot resolve JaCoCo source: {suffix}')
            files[source_path(str(matches[0]))] = {
                int(line.attrib['nr']): [int(line.attrib['ci']) > 0, int(line.attrib['cb']),
                                        int(line.attrib['cb']) + int(line.attrib['mb'])]
                for line in source.findall('line')
            }
    if not files or not any(files.values()):
        raise ValueError(f'Empty coverage report: {path}')
    return files


def changed_lines(base):
    # ponytail: diff/report-based estimate; Sonar's SCM/analyzer defines the exact metric.
    diff = git('diff', '--no-ext-diff', '--unified=0', '--no-renames', base, '--')
    changes = {}
    current = None
    for line in diff.splitlines():
        if line.startswith('+++ b/'):
            current = line[6:]
            changes.setdefault(current, set())
        elif line.startswith('+++ /dev/null'):
            current = None
        elif current and line.startswith('@@'):
            match = re.search(r'\+(\d+)(?:,(\d+))? @@', line)
            start = int(match[1])
            count = int(match[2]) if match[2] is not None else 1
            changes[current].update(range(start, start + count))
    for name in git('ls-files', '--others', '--exclude-standard', '-z').split('\0'):
        path = ROOT / name
        if name and path.is_file() and path.suffix in ('.ts', '.tsx', '.rs', '.kt', '.java'):
            changes[name] = set(range(1, len(path.read_text().splitlines()) + 1))
    return changes


def included(name, props):
    patterns = (props.get('sonar.exclusions', '') + ',' + props.get('sonar.coverage.exclusions', '')
                + ',' + props.get('sonar.test.inclusions', '')).split(',')
    return (any(name.startswith(root.rstrip('/') + '/') for root in props['sonar.sources'].split(','))
            and any(fnmatch.fnmatch(name, p) for p in props['sonar.inclusions'].split(','))
            and not name.endswith('.d.ts')
            and not any(fnmatch.fnmatch(name, p) for p in patterns if p))


def summarize(files, changes=None):
    covered = total = 0
    for name, lines in files.items():
        for number, (hit, covered_branches, branches) in lines.items():
            if changes is None or number in changes.get(name, set()):
                covered += int(hit) + covered_branches
                total += 1 + branches
    return covered, total


def non_executable_typescript(names):
    names = sorted(name for name in names if name.endswith(('.ts', '.tsx')))
    if not names:
        return set()
    # Use the installed compiler: interfaces/types emit no executable JS;
    # import/re-export barrels also have no coverable logic of their own.
    script = """
        import ts from 'typescript';
        import { readFileSync } from 'node:fs';
        console.log(JSON.stringify(process.argv.slice(1).filter(name => {
            const js = ts.transpileModule(readFileSync(name, 'utf8'),
                { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
            const source = ts.createSourceFile(name + '.js', js, ts.ScriptTarget.Latest);
            return source.statements.every(s => ts.isImportDeclaration(s)
                || ts.isExportDeclaration(s) || ts.isEmptyStatement(s));
        })));
    """
    return set(json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e', script, *names], cwd=ROOT)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', help='Explicit baseline commit for offline validation')
    parser.add_argument('--branch', default='main', help='Sonar branch whose baseline is used')
    parser.add_argument('--reports-only', action='store_true', help='Check existing reports without generating or caching them')
    parser.add_argument('--force', action='store_true', help='Regenerate reports even for an unchanged checkpoint')
    args = parser.parse_args()
    props = properties()
    base, threshold = (args.base, 80.0) if args.base else sonar_baseline(props, args.branch)
    base = git('rev-parse', '--verify', base + '^{commit}').strip()
    fingerprint = {'snapshot': snapshot(), 'base': base, 'threshold': threshold}
    report_paths = [ROOT / p for p in props['sonar.javascript.lcov.reportPaths'].split(',')]
    report_paths += [ROOT / props['sonar.rust.lcov.reportPaths'], ROOT / props['sonar.coverage.jacoco.xmlReportPaths']]
    if not args.force and not args.reports_only and CACHE.exists():
        if json.loads(CACHE.read_text()) == fingerprint and all(p.is_file() for p in report_paths):
            print('Coverage checkpoint already passed for these files and Sonar baseline; not repeated.')
            return
    if not args.reports_only:
        subprocess.run(['cargo', 'llvm-cov', '--version'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['docker', 'info', '--format', '{{.ServerVersion}}'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['pnpm', 'test:coverage'], cwd=ROOT, check=True)
        subprocess.run(['bash', 'scripts/coverage-native.sh'], cwd=ROOT, check=True)
    files = {}
    for path in report_paths:
        files.update(read_jacoco(path) if path.suffix == '.xml' else read_lcov(path))
    files = {name: lines for name, lines in files.items() if included(name, props)}
    changes = {name: lines for name, lines in changed_lines(base).items() if included(name, props) and lines}
    missing = changes.keys() - files.keys()
    for name in non_executable_typescript(missing):
        changes.pop(name)
    missing = changes.keys() - files.keys()
    if missing:
        raise ValueError('Changed production files absent from coverage reports: ' + ', '.join(sorted(missing)))
    print(f'Sonar baseline: {base}; required new coverage: {threshold:g}%')
    for label, suffixes in [('TypeScript', ('.ts', '.tsx')), ('Rust', ('.rs',)), ('JVM (Java/Kotlin)', ('.java', '.kt'))]:
        group = {name: lines for name, lines in files.items() if name.endswith(suffixes)}
        covered, total = summarize(group)
        print(f'{label}: {covered}/{total} line/condition units ({100 * covered / total:.1f}%)' if total else f'{label}: no coverage data')
    covered, total = summarize(files, changes)
    if total:
        percentage = 100 * covered / total
        print(f'New code coverage preflight: {covered}/{total} ({percentage:.1f}%)')
        if percentage < threshold:
            for name in changes:
                hits, units = summarize({name: files[name]}, changes)
                if units and hits / units < threshold / 100:
                    print(f'  {name}: {100 * hits / units:.1f}%')
            raise ValueError('New code coverage below threshold. This is a local estimate; Sonar is authoritative.')
    else:
        print('No new executable lines in the reports.')
    if snapshot() != fingerprint['snapshot']:
        raise ValueError('Files changed during verification; checkpoint not recorded.')
    if not args.reports_only:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(fingerprint))
    print('Coverage preflight passed. CI still confirms the full Sonar Quality Gate.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, KeyError, StopIteration) as error:
        raise SystemExit(f'Coverage checkpoint failed: {error}')
