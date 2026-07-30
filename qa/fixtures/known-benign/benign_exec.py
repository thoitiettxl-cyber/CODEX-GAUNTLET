import re
PATTERN = re.compile(r"^[a-z]+$")
def matches(value):
    return PATTERN.match(value)
