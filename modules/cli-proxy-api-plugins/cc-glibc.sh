#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PREFIX_DIR=${PREFIX:-/data/data/com.termux/files/usr}
TOOL_PREFIX="$ROOT/.cache/glibc-toolchain/data/data/com.termux/files/usr/glibc"
GCC_VERSION=14.2.1
GCC="$TOOL_PREFIX/bin/aarch64-linux-gnu-gcc-$GCC_VERSION"
GCC_LIB="$TOOL_PREFIX/lib/gcc/aarch64-linux-gnu/$GCC_VERSION"

for path in "$GCC" "$GCC_LIB/cc1" "$GCC_LIB/crtbeginS.o" "$GCC_LIB/crtendS.o"; do
	[[ -f "$path" ]] || {
		echo "missing cached glibc compiler component: $path" >&2
		exit 1
	}
done

# The wrapper itself starts under Android/bionic. Set the glibc search path only
# after Bash is running, then exec the extracted GCC whose absolute interpreter
# is the installed Termux glibc loader. Child cc1 processes inherit this path.
export LD_LIBRARY_PATH="$TOOL_PREFIX/lib:$PREFIX_DIR/glibc/lib"
exec "$GCC" \
	-B"$GCC_LIB/" \
	-B"$PREFIX_DIR/glibc/bin/" \
	-isystem "$PREFIX_DIR/glibc/include" \
	-L"$PREFIX_DIR/glibc/lib" \
	"$@"
