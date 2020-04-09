## Development
```bash
nix-shell
$ yarn --cwd static build
$ python -m server.opsavideo --static=static/dist
```

## Building
```bash
nix-build
./result/bin/opsavideo
```
