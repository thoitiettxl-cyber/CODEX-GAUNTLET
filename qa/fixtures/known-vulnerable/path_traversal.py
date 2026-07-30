def save(user_path, data):
    with open(user_path, "w") as handle:
        handle.write(data)
