import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest
import os
import subprocess

spec = importlib.util.spec_from_file_location('checkpoint', Path(__file__).with_name('verify-push.py'))
checkpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checkpoint)


class CoverageCheckpointTest(unittest.TestCase):
    def test_missing_report_is_allowed_only_for_non_executable_typescript(self):
        allowed = checkpoint.non_executable_typescript({
            'packages/backend/src/protocol.ts',
            'packages/autocomplete-engine/src/index.ts',
            'packages/adapters-pg/src/pg-adapter.ts',
        })
        self.assertEqual(allowed, {'packages/backend/src/protocol.ts', 'packages/autocomplete-engine/src/index.ts'})
        props = checkpoint.properties()
        self.assertFalse(checkpoint.included('apps/desktop/src/test/setup.ts', props))
        self.assertFalse(checkpoint.included('packages/backend/test/in-memory-adapter.ts', props))
        self.assertTrue(checkpoint.included('services/jvm-sidecar/src/main/java/dev/Example.java', props))

    def test_lcov_jvm_baseline_and_changed_line_metrics(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'services/jvm-sidecar/src/main/java/dev/Example.java'
            source.parent.mkdir(parents=True)
            source.write_text('class Example {}\n')
            lcov = root / 'coverage.info'
            lcov.write_text('SF:packages/example/src/main.ts\nDA:1,1\nDA:2,0\n'
                            'BRDA:1,0,0,1\nBRDA:1,0,1,-\nend_of_record\n')
            xml = root / 'coverage.xml'
            xml.write_text('<report><package name="dev"><sourcefile name="Example.java">'
                           '<line nr="1" mi="0" ci="5" mb="1" cb="1"/>'
                           '</sourcefile></package></report>')
            with patch.object(checkpoint, 'ROOT', root):
                files = checkpoint.read_lcov(lcov) | checkpoint.read_jacoco(xml)
                self.assertEqual(checkpoint.summarize(files), (4, 7))
                self.assertEqual(checkpoint.summarize(files, {'packages/example/src/main.ts': {2}}), (0, 1))
                source.rename(source.with_suffix('.kt'))
                xml.write_text(xml.read_text().replace('Example.java', 'Example.kt'))
                source = source.with_suffix('.kt')
                kotlin = root / 'services/jvm-sidecar/src/main/kotlin/dev/Example.kt'
                kotlin.parent.mkdir(parents=True)
                source.rename(kotlin)
                self.assertIn('services/jvm-sidecar/src/main/kotlin/dev/Example.kt', checkpoint.read_jacoco(xml))
            lcov.write_text('')
            with self.assertRaisesRegex(ValueError, 'Empty coverage'):
                checkpoint.read_lcov(lcov)
        diff = '+++ b/example.ts\n@@ -1 +1,2 @@\n+x\n+y\n@@ -7 +8,0 @@\n-old\n'
        with patch.object(checkpoint, 'git', side_effect=[diff, '']):
            self.assertEqual(checkpoint.changed_lines('baseline'), {'example.ts': {1, 2}})
        props = {'sonar.projectKey': 'test'}
        status = {'projectStatus': {'periods': [{'date': '2026-07-21'}],
                  'conditions': [{'metricKey': 'new_coverage', 'errorThreshold': '80'}]}}
        with patch.object(checkpoint, 'api', side_effect=[status, {'analyses': [
            {'date': '2026-09-30', 'revision': 'latest'}, {'date': '2026-07-21', 'revision': 'baseline'}]}]):
            self.assertEqual(checkpoint.sonar_baseline(props, 'main'), ('baseline', 80))

    def test_light_precommit_and_release_guard(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '-q', directory], check=True)
            (root / 'README.md').write_text('Documentation change\n')
            subprocess.run(['git', '-C', directory, 'add', 'README.md'], check=True)
            subprocess.run(['node', str(checkpoint.ROOT / 'scripts/precommit.mjs')], cwd=root, check=True)
            with patch.object(checkpoint, 'ROOT', root):
                before = checkpoint.snapshot()
                (root / 'README.md').write_text('Updated documentation\n')
                self.assertEqual(checkpoint.snapshot(), before)
                (root / 'source.ts').write_text('export const value = 1;\n')
                self.assertNotEqual(checkpoint.snapshot(), before)
            subprocess.run(['git', '-C', directory, 'add', 'source.ts'], check=True)
            fake_pnpm = root / 'pnpm.mjs'
            fake_pnpm.write_text("import {writeFileSync} from 'node:fs'; writeFileSync('lint-args.json', JSON.stringify(process.argv.slice(2)));")
            subprocess.run(['node', str(checkpoint.ROOT / 'scripts/precommit.mjs')], cwd=root, check=True,
                           env=dict(os.environ, npm_execpath=str(fake_pnpm)))
            self.assertEqual((root / 'lint-args.json').read_text(), '["exec","eslint","source.ts"]')
            gh = root / 'gh'
            gh.write_text('#!/bin/sh\nprintf "%s\\n" "$FAKE_CI_RESULT"\n')
            gh.chmod(0o755)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       GITHUB_REPOSITORY='test/repo', GITHUB_SHA='test-sha', RELEASE_BRANCH='main')
            for result, expected in [('completed success https://ci', 0), ('completed failure https://ci', 1)]:
                env['FAKE_CI_RESULT'] = result
                process = subprocess.run(['bash', str(checkpoint.ROOT / 'scripts/require-release-ci.sh')],
                                         env=env, capture_output=True)
                self.assertEqual(process.returncode, expected, process.stderr.decode())
            # A cold native build can still be running after the former 90 polls.
            gh.write_text('#!/bin/sh\ncount=0\nif [ -f "$FAKE_COUNTER" ]; then read -r count < "$FAKE_COUNTER"; fi\ncount=$((count + 1))\nprintf "%s\\n" "$count" > "$FAKE_COUNTER"\nif [ "$count" -lt 95 ]; then echo "in_progress pending https://ci"; else echo "completed success https://ci"; fi\n')
            sleep = root / 'sleep'
            sleep.write_text('#!/bin/sh\nexit 0\n')
            sleep.chmod(0o755)
            counter = root / 'ci-polls'
            env['FAKE_COUNTER'] = str(counter)
            process = subprocess.run(['bash', str(checkpoint.ROOT / 'scripts/require-release-ci.sh')],
                                     env=env, capture_output=True)
            self.assertEqual(process.returncode, 0, process.stderr.decode())
            self.assertEqual(counter.read_text().strip(), '95')


if __name__ == '__main__':
    unittest.main()
