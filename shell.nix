{ pkgs ? import <nixpkgs> {} }:

let
  zine = pkgs.stdenv.mkDerivation {
    pname = "zine";
    version = "0.11.3";
    src = pkgs.fetchurl {
      url = "https://github.com/kristoff-it/zine/releases/download/v0.11.3/x86_64-linux-musl.tar.xz";
      sha256 = "sha256-wl5Tcril0nWfK35YGu+5DIAZ/wBWojCpfv48jtqzvBk=";
    };
    sourceRoot = ".";
    installPhase = ''
      mkdir -p $out/bin
      install -m755 zine $out/bin/zine
    '';
    dontFixup = true;
  };
in
  pkgs.mkShell {
    name = "otp-migrate";
    packages = with pkgs; [
      nodejs
      zine
    ];
    shellHook = ''
      echo "otp-migrate.sccl.cc dev shell"
      echo "  npm run dev      — dev server with live reload"
      echo "  npm run build    — build to public/"
      echo "  npm run preview  — serve public/"
    '';
  }
