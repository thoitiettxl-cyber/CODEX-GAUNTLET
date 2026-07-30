import subprocess
def run(argv):
    return subprocess.run(argv, shell=False, check=True)
