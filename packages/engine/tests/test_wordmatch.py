from opencmo.wordmatch import find_whole_word, spans_in


def test_khong_khop_chuoi_con():
    # "I" nằm trong "This" nhưng không phải một từ
    assert find_whole_word("and this all failed.", "i", 0) == -1


def test_khop_tu_tron_ven():
    assert find_whole_word("and then i lose", "i", 0) == 9


def test_dau_nhay_thuoc_ve_tu():
    """Whisper trả "it's" là MỘT từ. Nếu dấu nháy không tính là ký tự của từ thì
    "it" khớp vào giữa "it's" và mọi từ sau đó lệch theo."""
    assert find_whole_word("it's fine", "it", 0) == -1
    assert find_whole_word("it's fine", "it's", 0) == 0


def test_spans_tra_none_khi_co_tu_khong_khop():
    assert spans_in("hello world", ["hello", "zzz"]) is None


def test_spans_dung_thu_tu():
    assert spans_in("a b a", ["a", "b", "a"]) == [(0, 1), (2, 3), (4, 5)]
