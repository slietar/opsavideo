from setuptools import setup, find_packages

setup(
  name='opsavideo',
  version='0.0.1',
  packages=['opsavideo'],
  package_dir={"opsavideo": "server"},
  entry_points={
    "console_scripts": [
      "opsavideo = opsavideo:main",
    ]
  }
)

