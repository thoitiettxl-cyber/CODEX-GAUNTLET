GO ?= go
FUZZ_TIME ?= 15s

.PHONY: test test-race fuzz

test:
	$(GO) test ./... -count=1

test-race:
	$(GO) test -race ./... -count=1

fuzz:
	$(GO) test ./... -run=^$$ -fuzz=^FuzzCredentialProjection$$ -fuzztime=$(FUZZ_TIME)
	$(GO) test ./... -run=^$$ -fuzz=^FuzzManagementEnvelope$$ -fuzztime=$(FUZZ_TIME)
