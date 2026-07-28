GO ?= go
FUZZ_TIME ?= 15s

.PHONY: test test-race fuzz abi linux-ci

test:
	$(GO) test ./... -count=1

test-race:
	$(GO) test -race ./... -count=1

fuzz:
	$(GO) test ./... -run=^$$ -fuzz=^FuzzDecodeConfig$$ -fuzztime=$(FUZZ_TIME)
	$(GO) test ./... -run=^$$ -fuzz=^FuzzSchedulerRequestEnvelope$$ -fuzztime=$(FUZZ_TIME)
	$(GO) test ./... -run=^$$ -fuzz=^FuzzManagementRouteDecoder$$ -fuzztime=$(FUZZ_TIME)

abi:
	build_dir="$$(mktemp -d)" && \
	trap 'rm -rf -- "$$build_dir"' EXIT INT TERM && \
	CGO_ENABLED=1 $(GO) build -trimpath -buildvcs=false -buildmode=c-shared -o "$$build_dir/policy-scheduler.so" . && \
	file "$$build_dir/policy-scheduler.so" | grep -q 'ELF 64-bit LSB shared object' && \
	readelf -Ws "$$build_dir/policy-scheduler.so" | grep -q ' cliproxy_plugin_init$$'

linux-ci: test-race fuzz abi
