use ping::{echo, pong};

#[test]
fn pong_returns_pong() {
    assert_eq!(pong(), "pong");
}

#[test]
fn echo_returns_the_same_text() {
    assert_eq!(echo("hello"), "hello");
}
