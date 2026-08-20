pub fn pong() -> &'static str {
    "pong"
}

pub fn echo(message: &str) -> String {
    message.to_owned()
}
