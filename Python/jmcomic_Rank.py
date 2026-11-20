from jmcomic import JmOption


def main():
    client = JmOption.default().new_jm_client()
    page = client.week_ranking(1)
    for album_id, title in page:
        print(album_id, title)


if __name__ == '__main__':
    main()
