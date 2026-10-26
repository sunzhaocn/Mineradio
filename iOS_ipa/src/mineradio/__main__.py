"""Keep early launch errors accessible through the app's shared Documents."""
from pathlib import Path
import locale
import os
import traceback


def run():
    report = Path.home() / 'Documents' / 'Mineradio-startup-diagnostic.txt'
    stage = 'configure locale'

    def save(message):
        try:
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text(message, encoding='utf-8')
        except OSError:
            # Diagnostics must never prevent the app from launching.
            pass

    try:
        save('Stage: ' + stage + '\n')
        # Toga selects the default POSIX locale during App construction. Some
        # physical iPads supply a locale name that their C runtime cannot load.
        # Configure this before UI/background threads, and retain valid locales.
        try:
            locale.setlocale(locale.LC_ALL, '')
        except locale.Error:
            os.environ['LC_ALL'] = 'C'
            locale.setlocale(locale.LC_ALL, 'C')
        stage = 'import application'
        save('Stage: ' + stage + '\n')
        from mineradio.app import main
        stage = 'create application'
        save('Stage: ' + stage + '\n')
        application = main()
        stage = 'run application main loop'
        save('Stage: ' + stage + '\n')
        application.main_loop()
    except BaseException:
        save('Stage: ' + stage + '\n' + traceback.format_exc())
        raise


run()
